'use strict';
const JournalTranslation = (() => {
  const PROVIDER='MyMemory', LIMIT=5000, EMAIL_LIMIT=50000, MAX_BYTES=450;
  function normalizeEmail(value){const email=String(value||'').trim();if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw new Error('请输入有效的联系邮箱，或留空使用匿名翻译。');return email;}
  const encoder=new TextEncoder();
  function splitText(text,maxBytes=MAX_BYTES) {
    const chunks=[];let rest=text;
    while(rest){
      let end=0,bytes=0,boundary=0,sentence=0,clause=0;
      for(const char of rest){const size=encoder.encode(char).length;if(bytes+size>maxBytes)break;bytes+=size;end+=char.length;if(/\s/u.test(char))boundary=end;if(/[.!?。！？]/u.test(char)&&(!rest[end]||/\s/u.test(rest[end])))sentence=end;if(/[,;:，；：]/u.test(char))clause=end;}
      if(!end)throw new Error('无法分段处理摘要');
      if(end<rest.length){if(sentence>end/4)end=sentence;else if(clause>end/2)end=clause;else if(boundary>end/2)end=boundary;}
      chunks.push(rest.slice(0,end));rest=rest.slice(end);
    }
    return chunks;
  }
  async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
  function browserStore(){
    let database;
    const open=()=>database??=new Promise((resolve,reject)=>{const r=indexedDB.open('journal-radar-translations',1);r.onupgradeneeded=()=>r.result.createObjectStore('cache');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法打开翻译缓存，请检查浏览器存储设置'));});
    async function operation(mode,key,value){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('cache',mode),store=tx.objectStore('cache');const r=mode==='readonly'?store.get(key):store.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(new Error('翻译缓存保存失败'));tx.onabort=()=>reject(new Error('翻译缓存操作中断'));});}
    return {get:key=>operation('readonly',key),put:(key,value)=>operation('readwrite',key,value)};
  }
  function decode(text){return text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[s]));}
  class Engine {
    constructor({store,fetcher=(url,options)=>fetch(url,options),clock=Date.now,getEmail=()=>''}={}){this.store=store||browserStore();this.fetcher=fetcher;this.clock=clock;this.getEmail=getEmail;this.queue=Promise.resolve();}
    async cached(text){return this.store.get('mymemory-en-zh-v1:'+await digest(String(text).trim()));}
    async restore(source,text){
      if(typeof source!=='string'||!source.trim()||source.length>20000||typeof text!=='string'||!text.trim()||text.length>100000)throw new Error('备份译文无效');
      const key='mymemory-en-zh-v1:'+await digest(source.trim());
      if(!(await this.store.get(key))?.text)await this.store.put(key,{text,provider:PROVIDER,imported:true,created_at:new Date(this.clock()).toISOString()});
    }
    translate(text,options={}){
      const execute=()=>typeof navigator!=='undefined'&&navigator.locks?navigator.locks.request('journal-radar-free-translation',()=>this.run(text,options)):this.run(text,options);
      const result=this.queue.then(execute);this.queue=result.catch(()=>{});return result;
    }
    async run(text,{signal,onProgress=()=>{}}={}){
      text=String(text||'').trim();if(!text)throw new Error('当前文章没有可翻译的摘要');
      if(text.length>20000)throw new Error('摘要过长，请先阅读原文');
      signal?.throwIfAborted();
      const key='mymemory-en-zh-v1:'+await digest(text);
      const cached=await this.store.get(key);if(cached?.text)return {...cached,cached:true};
      const email=normalizeEmail(this.getEmail()),limit=email?EMAIL_LIMIT:LIMIT;
      const chunks=splitText(text),parts=[];
      const keys=await Promise.all(chunks.map(c=>digest(c).then(h=>'segment-en-zh-v1:'+h)));
      const stored=await Promise.all(keys.map(k=>this.store.get(k)));
      let usage=(await this.store.get('usage')||[]).filter(x=>x.at>this.clock()-86400000);
      const needed=chunks.reduce((sum,c,i)=>sum+(stored[i]?.text?0:c.length),0);
      if(usage.reduce((sum,x)=>sum+x.chars,0)+needed>limit)throw new Error(`本机近 24 小时免费翻译额度不足（${email?'邮箱版约 50,000':'匿名版约 5,000'} 英文字符）。已缓存的译文仍可阅读，请稍后再试。`);
      for(let i=0;i<chunks.length;i++){
        signal?.throwIfAborted();onProgress(i,chunks.length);
        if(stored[i]?.text){parts.push(stored[i].text);continue;}
        // Reserve before sending: retries and interrupted requests must not silently overrun the budget.
        usage.push({at:this.clock(),chars:chunks[i].length});await this.store.put('usage',usage);
        const timeout=AbortSignal.timeout(25000),requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
        let response;
        const params=new URLSearchParams({q:chunks[i],langpair:'en|zh-CN'});if(email)params.set('de',email);
        try{response=await this.fetcher('https://api.mymemory.translated.net/get?'+params,{signal:requestSignal,credentials:'omit',referrerPolicy:'no-referrer'});}
        catch(error){if(signal?.aborted)throw error;throw new Error('暂时无法连接免费翻译服务，请稍后重试。原文已保留。');}
        if(!response.ok)throw new Error('免费翻译服务暂时不可用（HTTP '+response.status+'），请稍后重试。');
        const result=await response.json();
        if(result.quotaFinished||Number(result.responseStatus)===429||/USED ALL AVAILABLE|DAILY LIMIT|QUOTA|NEXT AVAILABLE/i.test((result.responseDetails||'')+' '+(result.responseData?.translatedText||'')))throw new Error('免费翻译服务今日额度已用完。已缓存译文仍可阅读，请明天再试。');
        const translated=result.responseData?.translatedText;
        if(Number(result.responseStatus)!==200||typeof translated!=='string'||!translated.trim()||/^MYMEMORY WARNING/i.test(translated))throw new Error('翻译服务未返回有效译文'+(result.responseDetails?'：'+String(result.responseDetails).slice(0,120):'，请稍后重试。'));
        const value={text:decode(translated),provider:PROVIDER,created_at:new Date(this.clock()).toISOString()};
        await this.store.put(keys[i],value);parts.push(value.text);
      }
      const joined=parts.map((part,i)=>(i&&/[.!?。！？]\s*$/u.test(chunks[i-1])?'\n\n':'')+part).join('');
      const value={text:joined,provider:PROVIDER,created_at:new Date(this.clock()).toISOString()};
      await this.store.put(key,value);onProgress(chunks.length,chunks.length);return {...value,cached:false};
    }
  }
  return {Engine,splitText,LIMIT,EMAIL_LIMIT,normalizeEmail};
})();
if(typeof module!=='undefined')module.exports=JournalTranslation;
