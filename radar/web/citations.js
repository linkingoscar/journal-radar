'use strict';
const JournalCitations=(()=>{
  const text=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  function doi(value){return String(value||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase();}
  function date(item){return (item?.['date-parts']?.[0]||[]).map(String).join('-');}
  function fromCrossref(item,article,journal){
    if(doi(item.DOI)!==doi(article.doi||article.resolved_doi)||item.type!=='journal-article')throw new Error('来源返回的 DOI 或文献类型不匹配');
    if(journal.issns?.length&&!item.ISSN?.some(id=>journal.issns.includes(id)))throw new Error('来源返回的期刊 ISSN 不匹配');
    const authors=(item.author||[]).map(a=>a.family?{family:text(a.family),given:text(a.given)}:a.name?{literal:text(a.name)}:null).filter(Boolean);
    return {title:text(item.title?.[0]),journal:text(item['container-title']?.[0]||journal.name),authors,authors_incomplete:authors.length!==(item.author||[]).length,
      year:(date(item['published-print'])||date(item.published)||date(item['published-online'])).slice(0,4),
      volume:text(item.volume),issue:text(item.issue),pages:text(item.page),article_number:text(item['article-number']),
      doi:doi(item.DOI),status:'',checked_at:new Date().toISOString()};
  }
  function metadata(article,journal){
    return {title:article.title,journal:journal?.name||'',authors:[],year:(article.print_date||article.published_date||article.online_date||'').slice(0,4),
      volume:article.volume||'',issue:article.issue||'',pages:article.pages||'',article_number:article.article_number||'',doi:doi(article.doi||article.resolved_doi),status:'',...article.citation};
  }
  function warnings(c){
    const result=[];
    if(!c.authors.length)result.push('作者姓与名尚未核验');
    else if(c.authors_incomplete)result.push('部分作者信息不完整，请对照原文补齐');
    if(!c.year)result.push('发表年份缺失');
    if(!c.title)result.push('文章标题缺失');
    if(!c.journal)result.push('期刊名称缺失');
    if(c.status!=='advance online publication'){
      if(!c.volume)result.push('卷号缺失，是否提前在线发表需核对');
      if(!c.pages&&!c.article_number)result.push('页码或文章编号缺失');
    }
    if(!c.doi)result.push('DOI 缺失');
    return result;
  }
  function toCSL(c,id){
    const item={id,type:'article-journal',title:text(c.title),'container-title':text(c.journal),language:'en',
      author:c.authors.map(a=>Object.fromEntries(Object.entries(a).map(([k,v])=>[k,text(v)]))),
      volume:text(c.volume),issue:text(c.issue),page:text(c.pages),number:text(c.article_number),DOI:doi(c.doi),status:c.status};
    if(c.year)item.issued={'date-parts':[[Number(c.year)]]};
    return item;
  }
  function unique(rows){
    const result=new Map();
    for(const row of rows){const key=doi(row.citation.doi)||row.id,old=result.get(key);if(!old||warnings(row.citation).length<warnings(old.citation).length)result.set(key,row);}
    return [...result.values()];
  }
  function format(rows,{processor,style,locale}){
    rows=unique(rows);if(!rows.length)throw new Error('请先选择文章');
    const items=Object.fromEntries(rows.map(row=>[row.id,toCSL(row.citation,row.id)]));
    const make=mode=>{const engine=new processor.Engine({retrieveLocale:()=>locale,retrieveItem:id=>structuredClone(items[id])},style,'en-US');engine.setOutputFormat(mode);engine.updateItems(Object.keys(items));return engine;};
    const html=make('html'),plain=make('text'),bibliography=html.makeBibliography(),plainBibliography=plain.makeBibliography();
    return {rows,html:bibliography[1].join(''),text:plainBibliography[1].map(s=>s.trim()).join('\n\n'),
      entries:rows.map(row=>{
        let author=plain.makeCitationCluster([{id:row.id,'author-only':true}]);
        const delimiter=author.lastIndexOf(' & ');
        if(row.citation.authors.length>1&&delimiter>=0)author=author.slice(0,delimiter)+' and '+author.slice(delimiter+3);
        return {id:row.id,title:row.citation.title,warnings:warnings(row.citation),
          parenthetical:plain.makeCitationCluster([{id:row.id}]),
          narrative:author+' '+plain.makeCitationCluster([{id:row.id,'suppress-author':true}])};
      })};
  }
  class Engine{
    constructor({remember,fetcher=(...args)=>fetch(...args)}){this.remember=remember;this.fetcher=fetcher;this.assets=null;}
    async assetsFor(){
      if(!this.assets)this.assets=Promise.all(['apa.csl','locales-en-US.xml'].map(async url=>{const r=await this.fetcher(url);if(!r.ok)throw new Error('APA 格式文件加载失败，请刷新后重试');return r.text();})).catch(error=>{this.assets=null;throw error;});
      const [style,locale]=await this.assets;return {processor:CSL,style,locale};
    }
    async enrich(article,journal,signal){
      const id=doi(article.doi||article.resolved_doi);if(!/^10\.\d{4,9}\/\S+$/.test(id))return {citation:metadata(article,journal),error:'没有可用于补取的 DOI'};
      if(article.citation&&(article.citation.manual||Date.now()-Date.parse(article.citation.checked_at)<7*86400000))return {citation:article.citation};
      try{
        const r=await this.fetcher('https://api.crossref.org/works/'+encodeURIComponent(id),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers:{Accept:'application/json'}});
        if(!r.ok)throw new Error(r.status===429?'来源限流，请稍后重试':'书目信息补取失败（'+r.status+'）');
        const citation=fromCrossref((await r.json()).message,article,journal);
        signal.throwIfAborted();this.remember({...article,citation});return {citation};
      }catch(error){if(signal.aborted)throw error;return {citation:metadata(article,journal),error:error.name==='TimeoutError'?'书目信息补取超时':error.message};}
    }
  }
  return {doi,fromCrossref,metadata,warnings,toCSL,unique,format,Engine};
})();
if(typeof module!=='undefined')module.exports=JournalCitations;
