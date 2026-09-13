'use strict';
const $ = s => document.querySelector(s);
const KEY = 'journal-radar:reading:v1';
let data = null, group = 'core10', view = 'all', limit = 40, installPrompt = null;
let state = {read:{}, saved:{}, custom:[]};
try { const old = JSON.parse(localStorage.getItem(KEY)); if (old) state = validateState(old); } catch { /* Recover with an empty state. */ }
function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效备份');
  const map = name => {
    const result = {};
    if (input[name] && typeof input[name] === 'object' && !Array.isArray(input[name])) {
      for (const [id,value] of Object.entries(input[name])) if (/^[a-f0-9]{64}$/.test(id) && value === true) result[id] = true;
    }
    return result;
  };
  return {read:map('read'),saved:map('saved'),custom:Array.isArray(input.custom)?[...new Set(input.custom.filter(s=>/^\d{4}-\d{3}[\dX]$/.test(s)))]:[]};
}
function persist() { try {localStorage.setItem(KEY,JSON.stringify(state));} catch {toast('无法保存到浏览器，请导出阅读记录备份。');} }
function el(tag, text, cls) { const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node; }
function button(text, action, cls) { const b=el('button',text,cls);b.type='button';b.addEventListener('click',action);return b; }
function toast(text) { $('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,4500); }
function label(g) { return {core10:'核心关注',ft50:'FT50',utd24:'UTD24',custom:'我的选刊',all:'全部期刊'}[g]; }
function inGroup(j) {return group==='all'||(group==='custom'?state.custom.includes(j.id):j.groups.includes(group));}
function readableDate(s) {return s?s.slice(0,10).replaceAll('-','.'):'日期未提供';}
function safeLink(s) {try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'#';}catch{return '#';}}
function updateJournals() {
  const select=$('#journal');select.replaceChildren(new Option('所有期刊',''));
  for (const j of data.journals.filter(inGroup).sort((a,b)=>a.name.localeCompare(b.name)))select.add(new Option(j.name,j.id));
  $('#custom-count').textContent=state.custom.length;$('#all-count').textContent=data.journals.length;
}
function toggle(kind,id) { if(state[kind][id])delete state[kind][id];else state[kind][id]=true;persist();render(); }
function openArticle(article) {
  const journal=data.journals.find(j=>j.id===article.journal_id);
  const content=$('#reader-content');content.replaceChildren();
  content.append(el('div',journal.name,'eyebrow'),el('h2',article.title,'reader-title'),el('p',article.authors||'作者信息暂缺','reader-meta'));
  content.append(el('p','发表：'+readableDate(article.published_date)+(article.online_date?' · 在线发表：'+readableDate(article.online_date):'')+(article.print_date?' · 正式刊期：'+readableDate(article.print_date):''),'reader-meta'));
  content.append(el('p',article.abstract||'当前来源未提供摘要，可以打开原文页面查看。','reader-abstract'));
  if(article.doi)content.append(el('p','DOI '+article.doi,'reader-doi'));
  const actions=el('div',undefined,'reader-buttons');
  const link=el('a','打开原文 ↗','primary');link.href=safeLink(article.link);link.target='_blank';link.rel='noopener noreferrer';
  actions.append(link,button(state.saved[article.id]?'★ 已收藏':'☆ 收藏',e=>{toggle('saved',article.id);e.currentTarget.textContent=state.saved[article.id]?'★ 已收藏':'☆ 收藏';}));
  content.append(actions);state.read[article.id]=true;persist();render();$('#reader').showModal();
}
function render() {
  if(!data)return;
  const journals=data.journals.filter(inGroup), ids=new Set(journals.map(j=>j.id));
  const all=data.articles.filter(a=>ids.has(a.journal_id));
  $('#article-total').textContent=all.length.toLocaleString();
  const title=$('#group-title');title.replaceChildren(document.createTextNode(label(group)),el('span','的新进展'));
  $('#group-description').textContent=group==='core10'?'从你关心的 10 本期刊开始，发现值得细读的研究。':group==='ft50'?'FT50 · 2026 年 4 月版，50 本期刊的研究动态。':group==='utd24'?'UTD24 · 跨管理、金融、营销、会计与信息系统。':group==='custom'?'在「管理期刊与数据源」中选择你想单独关注的期刊。':'全部期刊汇聚于此，重叠清单合并展示。';
  const q=$('#search').value.trim().toLowerCase(), selected=$('#journal').value;
  const days=$('#period').value;const cutoff=days==='all'?'':new Date(Date.now()-Number(days)*86400000).toISOString().slice(0,10);
  let articles=all.filter(a=>(!selected||a.journal_id===selected)&&(!cutoff||a.published_date>=cutoff)&&(!q||[a.title,a.authors,a.abstract,a.doi].some(x=>(x||'').toLowerCase().includes(q)))&&(view!=='unread'||!state.read[a.id])&&(view!=='saved'||state.saved[a.id]));
  const sortKey=$('#sort').value==='published'?'published_date':'first_seen';
  articles.sort((a,b)=>(b[sortKey]||'').localeCompare(a[sortKey]||'')||a.id.localeCompare(b.id));
  $('#result-count').textContent=`${articles.length.toLocaleString()} 篇文章 · ${journals.length} 本期刊`;
  $('#updated').textContent='数据生成于 '+new Date(data.generated_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const failures=journals.filter(j=>j.status==='error'||j.status==='partial');
  const pending=journals.filter(j=>j.status==='pending');
  const stale=Date.now()-new Date(data.generated_at).getTime()>48*3600000;
  $('#notice').hidden=!failures.length&&!pending.length&&!stale;
  $('#notice').textContent=[failures.length?`${failures.length} 本期刊存在来源请求失败，历史文章仍可阅读。详情见「管理期刊与数据源」。`:'',pending.length?`${pending.length} 本期刊等待首次采集。`:'',stale?'数据已超过 48 小时未更新，请检查云端采集任务。':''].filter(Boolean).join(' ');
  const list=$('#articles');list.replaceChildren();
  if(!articles.length){const box=el('div',undefined,'empty');box.append(el('strong','这里暂时没有文章'),el('p',view==='saved'?'点击文章旁的「收藏」，把值得细读的研究留在这里。':'试试放宽时间范围、清除关键词，或切换期刊分组。'));list.append(box);}
  const byId=new Map(data.journals.map(j=>[j.id,j]));
  for(const article of articles.slice(0,limit)){
    const j=byId.get(article.journal_id), card=el('article',undefined,'article'+(state.read[article.id]?' is-read':''));
    const top=el('div',undefined,'article-top');top.append(el('span',j.name,'journal-name'),el('time',readableDate(article.published_date),'date'));
    const heading=el('h2');heading.append(button(article.title,()=>openArticle(article)));
    card.append(top,heading,el('p',article.authors||'作者信息暂缺','authors'),el('p',article.abstract||'当前来源未提供摘要，打开原文查看详情。','abstract-preview'));
    const bottom=el('div',undefined,'article-bottom'),tags=el('div',undefined,'tags'),actions=el('div',undefined,'article-actions');
    j.groups.forEach(g=>tags.append(el('span',label(g),'tag')));
    if(article.article_type!=='journal-article'&&article.article_type!=='rss-entry')tags.append(el('span',article.article_type,'tag'));
    const read=button(state.read[article.id]?'✓ 已读':'标记已读',()=>toggle('read',article.id));read.setAttribute('aria-label',(state.read[article.id]?'标为未读：':'标为已读：')+article.title);
    const saved=button(state.saved[article.id]?'★ 已收藏':'☆ 收藏',()=>toggle('saved',article.id),state.saved[article.id]?'saved':'');saved.setAttribute('aria-pressed',String(!!state.saved[article.id]));saved.setAttribute('aria-label',(state.saved[article.id]?'取消收藏：':'收藏：')+article.title);
    const link=el('a','原文 ↗');link.href=safeLink(article.link);link.target='_blank';link.rel='noopener noreferrer';
    actions.append(read,saved,link);bottom.append(tags,actions);card.append(bottom);list.append(card);
  }
  $('#more').hidden=articles.length<=limit;
}
async function load(){
  $('#refresh').disabled=true;
  try{
    const response=await fetch('data.json?t='+Date.now(),{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const next=await response.json();if(!Array.isArray(next.articles)||!Array.isArray(next.journals))throw new Error('数据格式错误');
    const previous=$('#journal').value;data=next;updateJournals();if([...$('#journal').options].some(o=>o.value===previous))$('#journal').value=previous;render();
    $('#connection').textContent=navigator.onLine?'阅读数据已载入':'离线阅读';
  }catch(error){$('#connection').textContent='暂时无法更新';$('#notice').hidden=false;$('#notice').textContent='读取失败，请检查网络后重试。'+(data?' 已保留当前文章。':'');}
  finally{$('#refresh').disabled=false;}
}
function settings(){
  const list=$('#journal-settings');list.replaceChildren();
  for(const j of data.journals){
    const row=el('div',undefined,'journal-setting'),labelNode=el('label'),check=el('input');check.type='checkbox';check.checked=state.custom.includes(j.id);
    check.addEventListener('change',()=>{state.custom=check.checked?[...state.custom,j.id]:state.custom.filter(id=>id!==j.id);persist();updateJournals();render();});
    labelNode.append(check,document.createTextNode(j.name));row.append(labelNode,el('small',j.groups.map(label).join(' · ')+' · ISSN '+j.issns.join(' / ')));
    if(j.coverage_note)row.append(el('small',j.coverage_note));
    for(const h of j.health){row.append(el('small',h.source.toUpperCase()+' · '+(!h.last_attempt?'等待首次采集':h.error?'本次失败：'+h.error:`请求完成，返回 ${h.item_count} 条`)+(h.last_success?' · 上次成功 '+new Date(h.last_success).toLocaleString('zh-CN'):''),h.error?'health-error':'health-ok'));}
    list.append(row);
  }$('#settings').showModal();
}
$('#groups').addEventListener('click',event=>{const b=event.target.closest('[data-group]');if(!b||!data)return;group=b.dataset.group;limit=40;$('#groups').querySelectorAll('button').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});updateJournals();render();});
$('#views').addEventListener('click',event=>{const b=event.target.closest('[data-view]');if(!b)return;view=b.dataset.view;limit=40;$('#views').querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});render();});
['search','journal','period','sort'].forEach(id=>$('#'+id).addEventListener(id==='search'?'input':'change',()=>{limit=40;render();}));
$('#more').addEventListener('click',()=>{limit+=40;render();});$('#refresh').addEventListener('click',load);
$('#manage').addEventListener('click',()=>{if(data)settings();});
document.querySelectorAll('.close').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('#backup').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,exported_at:new Date().toISOString(),...state},null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='journal-radar-reading-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('阅读记录已导出');});
$('#restore').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>5e6)throw new Error('备份过大');const input=JSON.parse(await file.text());if(input.version!==1||!input.read||!input.saved||!Array.isArray(input.custom))throw new Error('格式不匹配');const restored=validateState(input);state={read:{...state.read,...restored.read},saved:{...state.saved,...restored.saved},custom:[...new Set([...state.custom,...restored.custom])]};persist();if(data){updateJournals();render();}toast('已合并导入阅读记录');}catch{toast('无法导入：请选择期刊雷达导出的 JSON 备份。');}event.target.value='';});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;});
$('#install').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else $('#help').showModal();});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){event.preventDefault();$('#search').focus();}});
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
load();
