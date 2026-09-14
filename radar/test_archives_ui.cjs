const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/web/archives.js','utf8');
function fixture(){
  const document={activeElement:null};
  class Node {
    constructor(){this.children=[];this.dataset={};this.value='';this.replacements=0;}
    contains(node){return this===node||this.children.some(c=>c.contains(node));}
    replaceChildren(){if(this.contains(document.activeElement))document.activeElement=null;this.children=[];this.replacements++;}
    append(...nodes){this.children.push(...nodes);}
    setAttribute(){} addEventListener(){}
    querySelectorAll(){return this.children.flatMap(c=>[c,...c.querySelectorAll()]).filter(c=>c.dataset.archiveFocus);}
    focus(){document.activeElement=this;}
  }
  document.createElement=()=>new Node();
  const Class=vm.runInNewContext(source+'\nJournalArchives',{document,AbortController,console});
  const nodes=Object.fromEntries(['archive-articles','archive-search','archive-reading','archive-heading','archive-count','archive-issues'].map(id=>['#'+id,new Node()]));
  nodes['#archive-reading'].value='all';
  const state={read:{},saved:{}};
  const view=Object.create(Class.prototype);
  Object.assign(view,{$:selector=>nodes[selector],journal:{id:'0021-9010'},issue:'all',reading:()=>state,result:{checked_at:1,complete:true,articles:[{id:'a',title:'An existing article',authors:'A. Researcher',doi:'10.1000/a',volume:'1',issue:'2',pages:'1-5',year_basis:'print'}]}});
  return {view,nodes,state,document};
}
test('unrelated refresh preserves the existing directory DOM and keyboard focus',()=>{
  const {view,nodes,document}=fixture();view.paintArticles();const list=nodes['#archive-articles'];
  const focused=list.querySelectorAll().find(n=>n.dataset.archiveFocus==='saved:a');focused.focus();
  const replacements=list.replacements;view.paintArticles();
  assert.equal(list.replacements,replacements);assert.equal(document.activeElement,focused);
});
test('changing a reading flag restores focus to the same action after repaint',()=>{
  const {view,nodes,state,document}=fixture();view.paintArticles();
  nodes['#archive-articles'].querySelectorAll().find(n=>n.dataset.archiveFocus==='saved:a').focus();
  state.saved.a=true;view.paintArticles();
  assert.equal(document.activeElement.dataset.archiveFocus,'saved:a');
  assert.equal(document.activeElement.textContent,'★ 已收藏');
});

test('returning to a cached year while another year is pending restores its rows',async()=>{
  const {view,nodes}=fixture();
  const cached={...view.result,year:1980,reading_aliases:{}};
  Object.assign(view,{result:cached,desktop:true,generation:0,aliases:()=>{},paintIssues:()=>{},status:()=>{},busy:()=>{}});
  for(const id of ['archive-year','archive-years','archive-issues'])nodes['#'+id]={replaceChildren(){}};
  let finishPending;
  view.request=async(_id,query)=>query.includes('year=1981')?new Promise(resolve=>{finishPending=resolve;}):cached;
  view.paintArticles();
  const pending=view.loadYear(1981);
  await view.loadYear(1980);
  finishPending(cached);await pending;
  assert.equal(nodes['#archive-articles'].children.length,1);
  assert.equal(nodes['#archive-articles'].querySelectorAll().find(n=>n.dataset.archiveFocus==='open:a').textContent,'An existing article');
});

test('switching issue preserves the focused issue control',()=>{
  const {view,nodes,document}=fixture();view.paintIssues();
  nodes['#archive-issues'].children[1].focus();
  view.issue=view.key(view.result.articles[0]);view.paintIssues();
  assert.equal(document.activeElement.dataset.archiveIssue,view.issue);
  assert.equal(document.activeElement.textContent,'第 1 卷 · 第 2 期（1）');
});

test('a stale current year is refreshed once on entry while old rows survive a failed refresh',async()=>{
  const {view,nodes}=fixture(),year=new Date().getFullYear(),cached={...view.result,year,checked_at:Date.now()/1000-90000};
  Object.assign(view,{result:cached,desktop:true,generation:0,aliases:()=>{},paintIssues:()=>{},status:()=>{},busy:()=>{}});
  for(const id of ['archive-year','archive-years'])nodes['#'+id]={};
  const queries=[];view.request=async(_id,query)=>{queries.push(query);if(query.includes('refresh'))throw new Error('offline');return cached;};
  await view.loadYear(year);
  assert.equal(queries.length,2);assert(queries[1].endsWith('&refresh=1'));
  assert.equal(nodes['#archive-articles'].children.length,1);
});
