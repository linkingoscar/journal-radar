'use strict';
// No requests are made until enter() is called for a journal detail route.
class JournalArchives {
  constructor(options){
    Object.assign(this,options);this.journal=null;this.result=null;this.controller=null;this.generation=0;this.mode='archive';this.issue='all';
    this.$=s=>this.root.querySelector(s);
    this.$('#archive-year-form').addEventListener('submit',e=>{e.preventDefault();this.loadYear(Number(this.$('#archive-year').value));});
    this.$('#archive-years').addEventListener('change',e=>this.loadYear(Number(e.target.value)));
    this.$('#archive-refresh').addEventListener('click',()=>this.loadYear(Number(this.$('#archive-year').value),true));
    this.$('#archive-continue').addEventListener('click',()=>this.loadYear(Number(this.$('#archive-year').value)));
    this.$('#archive-stop').addEventListener('click',()=>{this.controller?.abort();this.status('已停止加载，完成的分页已缓存在本机。可继续加载。');this.busy(false);});
    this.$('#archive-search').addEventListener('input',()=>this.paintArticles());
    this.$('#archive-reading').addEventListener('change',()=>this.paintArticles());
    for(const mode of ['archive','recent'])this.$('#show-'+mode).addEventListener('click',()=>{this.mode=mode;if(mode==='recent')this.controller?.abort();this.onMode();if(mode==='archive'&&!this.result)this.loadYear(Number(this.$('#archive-year').value));});
  }
  status(text){this.$('#archive-status').textContent=text;}
  busy(value){this.$('#archive-stop').hidden=!value;this.$('#archive-continue').hidden=value||!!this.result?.complete;this.$('#archive-refresh').disabled=value;}
  sync(){
    this.root.hidden=!this.journal;
    if(!this.journal)return;
    this.$('#archive-content').hidden=this.mode!=='archive';
    for(const mode of ['archive','recent'])this.$('#show-'+mode).setAttribute('aria-pressed',String(mode===this.mode));
    this.paintArticles();
  }
  async enter(journal){
    this.controller?.abort();const generation=++this.generation;this.journal=journal;this.result=null;this.issue='all';this.mode=this.desktop?'archive':'recent';
    this.$('#archive-issues').replaceChildren();this.$('#archive-articles').replaceChildren();this.$('#archive-search').value='';this.$('#archive-reading').value='all';
    if(!journal){this.sync();return;}
    this.root.hidden=false;this.$('#archive-years').replaceChildren();this.$('#archive-year').value=new Date().getFullYear();this.$('#archive-year').max=new Date().getFullYear()+1;
    this.$('#archive-range').textContent='选择年份，浏览该年的卷期与文章。';
    this.$('#archive-local-link').hidden=this.desktop;this.$('#archive-controls').hidden=!this.desktop;
    this.$('#archive-local-link').href='http://127.0.0.1:8766/#journal='+journal.id;
    this.sync();
    if(!this.desktop){this.status('历史目录在本机版按需加载；网页版可切换查看近期动态。');return;}
    const controller=new AbortController();this.controller=controller;this.busy(true);this.status('正在查询此刊的历史年份范围…');
    try{
      const range=await this.request(journal.id,'',controller.signal);
      if(generation!==this.generation||controller.signal.aborted)return;
      const latest=Math.min(range.last_year||new Date().getFullYear(),new Date().getFullYear()+1);
      const first=range.first_year||latest;
      for(let year=latest;year>=first;year--)this.$('#archive-years').add(new Option(String(year),String(year)));
      this.$('#archive-range').textContent=range.first_year?`来源记录范围：${first}–${latest} 年 · 年份范围不代表已核实每年完整收录`:'来源未提供年份范围，可输入年份查询。';
      const initialYear=Math.min(latest,new Date().getFullYear());
      this.$('#archive-year').value=initialYear;
      await this.loadYear(initialYear);
    }catch(error){if(generation===this.generation&&!controller.signal.aborted){this.status(error.message+' 可输入年份重试。');this.busy(false);}}
  }
  async loadYear(year,refresh=false){
    if(!this.desktop||!this.journal||!Number.isInteger(year)||year<1500||year>new Date().getFullYear()+1)return;
    this.controller?.abort();const controller=new AbortController();this.controller=controller;const generation=++this.generation,journal=this.journal;
    if(this.result?.year!==year){this.result=null;this.issue='all';this.$('#archive-articles').replaceChildren();this.$('#archive-issues').replaceChildren();}
    this.$('#archive-year').value=year;this.$('#archive-years').value=String(year);this.busy(true);this.status(`正在读取 ${year} 年目录…`);
    try{
      let query=`?year=${year}${refresh?'&refresh=1':''}`;
      for(;;){
        const result=await this.request(journal.id,query,controller.signal);
        if(generation!==this.generation||controller.signal.aborted)return;
        this.result=result;this.aliases(result.reading_aliases||{});this.paintIssues();this.paintArticles();
        const stamp=new Date(result.checked_at*1000).toLocaleString('zh-CN');
        this.status(`${year} 年 · 已载入 ${result.articles.length} 条${result.complete?' · 本次来源查询完成':' · 正在继续分页'} · 更新于 ${stamp}。来源可能缺录，未与官方目录逐篇核验。`);
        if(result.complete)break;
        query=`?year=${year}&next=1`;
      }
    }catch(error){if(generation===this.generation&&!controller.signal.aborted)this.status(error.message+' 已载入目录保留，请重试。');}
    finally{if(generation===this.generation)this.busy(false);}
  }
  key(article){return JSON.stringify([article.volume||'',article.issue||'']);}
  issueName(key){const [volume,issue]=JSON.parse(key);return volume?`第 ${volume} 卷${issue?' · 第 '+issue+' 期':''}`:issue?`第 ${issue} 期 · 卷号待补`:'待归期 / Online First';}
  paintIssues(){
    const list=this.$('#archive-issues');list.replaceChildren();const counts=new Map();
    for(const a of this.result?.articles||[]){const key=this.key(a);counts.set(key,(counts.get(key)||0)+1);}
    if(this.issue!=='all'&&!counts.has(this.issue))this.issue='all';
    const add=(key,text)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-pressed',String(this.issue===key));b.addEventListener('click',()=>{this.issue=key;this.paintIssues();this.paintArticles();});list.append(b);};
    add('all',`全部卷期（${this.result?.articles.length||0}）`);
    const keys=[...counts.keys()].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
    for(const key of keys)add(key,`${this.issueName(key)}（${counts.get(key)}）`);
  }
  paintArticles(){
    if(!this.journal)return;
    const list=this.$('#archive-articles');list.replaceChildren();const q=this.$('#archive-search').value.trim().toLowerCase(),reading=this.$('#archive-reading').value,state=this.reading();
    const rows=(this.result?.articles||[]).filter(a=>(this.issue==='all'||this.key(a)===this.issue)&&(!q||[a.title,a.authors,a.doi,a.pages].some(x=>(x||'').toLowerCase().includes(q)))&&(reading==='all'||(reading==='saved'?state.saved[a.id]:!state.read[a.id])));
    rows.sort((a,b)=>this.key(b).localeCompare(this.key(a),undefined,{numeric:true})||(a.pages||a.article_number||'').localeCompare(b.pages||b.article_number||'',undefined,{numeric:true})||a.title.localeCompare(b.title));
    this.$('#archive-heading').textContent=this.issue==='all'?'本年目录':this.issueName(this.issue);
    this.$('#archive-count').textContent=`${rows.length} 条 · 搜索与阅读筛选仅作用于本年已加载目录`;
    const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    for(const article of rows){
      const row=node('li','','archive-row'),title=node('button',article.title,'archive-title');title.type='button';title.addEventListener('click',()=>this.open(article));
      const heading=node('h4','');heading.append(title);
      const meta=[article.authors||'作者信息暂缺',this.issueName(this.key(article)),article.pages?'页码 '+article.pages:article.article_number?'文章编号 '+article.article_number:'页码未提供'];
      if(article.year_basis!=='print')meta.push('年份依据发表日期，正式刊期日期待补');
      const actions=node('div','','archive-row-actions');
      for(const [kind,label] of [['read',state.read[article.id]?'✓ 已读':'标记已读'],['saved',state.saved[article.id]?'★ 已收藏':'☆ 收藏']]){const b=node('button',label);b.type='button';b.setAttribute('aria-pressed',String(!!state[kind][article.id]));b.setAttribute('aria-label',label+'：'+article.title);b.addEventListener('click',()=>{this.toggle(kind,article.id);this.paintArticles();});actions.append(b);}
      const link=node('a','原文 ↗');link.href='https://doi.org/'+article.doi;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
      row.append(heading,node('p',meta.join(' · '),'archive-meta'),actions);list.append(row);
    }
    if(!rows.length)list.append(node('li',this.result?.complete?'此筛选下暂无记录；来源无记录不代表该年未出版。':'目录尚未加载完成。','archive-empty'));
  }
}
