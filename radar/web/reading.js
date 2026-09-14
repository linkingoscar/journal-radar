'use strict';
const JournalReading=(()=>{
  const fields=['id','journal_id','title','authors','doi','link','abstract','abstract_source','abstract_url','published_date','print_date','online_date','first_seen','volume','issue','pages','article_number','article_type','sources','resolved_doi'];
  function article(value){
    if(!value||typeof value!=='object'||!(/^[a-f0-9]{64}$/).test(value.id)||!(/^\d{4}-\d{3}[\dX]$/).test(value.journal_id)||typeof value.title!=='string'||!value.title.trim())throw new Error('备份文章信息无效');
    const result={};
    for(const field of fields){const v=value[field];if(v!==undefined){if(typeof v!=='string'||v.length>(field==='abstract'?20000:4000))throw new Error('备份文章字段无效');result[field]=v;}}
    result.archive=value.archive===true;
    if(Number.isInteger(value.archive_year)&&value.archive_year>=1500&&value.archive_year<=9999)result.archive_year=value.archive_year;
    if(value.year_basis==='print'||value.year_basis==='publication')result.year_basis=value.year_basis;
    return result;
  }
  function merge(recent,remembered,aliases={}){
    const rows=new Map();
    for(const a of [...remembered,...recent]){
      const id=aliases[a.id]||a.id,old=rows.get(id);
      if(a.id!==id&&old)continue;
      // A new feed record must not erase a previously saved abstract.
      const next={...old,...a,id};if(!a.abstract&&old?.abstract)for(const k of ['abstract','abstract_source','abstract_url'])next[k]=old[k];
      rows.set(id,next);
    }
    return [...rows.values()];
  }
  function store(){
    let database;
    const open=()=>database??=new Promise((resolve,reject)=>{const r=indexedDB.open('journal-radar-reading-articles',1);r.onupgradeneeded=()=>r.result.createObjectStore('articles',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('无法打开文章备份缓存'));});
    return {async all(){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('articles'),r=tx.objectStore('articles').getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(new Error('无法读取文章备份缓存'));});},async put(rows){const clean=rows.map(article),db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('articles','readwrite');for(const row of clean)tx.objectStore('articles').put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(new Error('文章信息未能保存，请导出阅读记录'));tx.onabort=()=>reject(new Error('文章信息保存中断'));});}};
  }
  function backup(input){
    if(!input||![1,2].includes(input.version)||!input.read||!input.saved||!Array.isArray(input.custom))throw new Error('备份格式不匹配');
    const articles=input.version===2?(input.articles||[]):[];
    if(!Array.isArray(articles)||articles.length>20000)throw new Error('备份文章数量无效');
    const rows=articles.map(article),translations=input.version===2?(input.translations||[]):[];
    if(!Array.isArray(translations)||translations.length>20000||translations.some(x=>!x||typeof x.source!=='string'||!x.source.trim()||x.source.length>20000||typeof x.text!=='string'||!x.text.trim()||x.text.length>100000))throw new Error('备份译文无效');
    return {articles:rows,translations};
  }
  function manual(value,text){
    text=String(text).trim();if(text.length<80||text.length>20000)throw new Error('请粘贴完整的原文摘要（80–20,000 个字符）。');
    return article({...value,abstract:text,abstract_source:'手动摘录（未由来源接口核验）',abstract_url:value.link});
  }
  return {article,merge,store,backup,manual};
})();
if(typeof module!=='undefined')module.exports=JournalReading;
