const test=require('node:test'),assert=require('node:assert/strict');
const Reading=require('./web/reading.js');
const row={id:'a'.repeat(64),journal_id:'0021-9010',title:'A historical paper',doi:'10.1000/a',archive:true,archive_year:1980,abstract:'An abstract preserved in a backup',link:'https://doi.org/10.1000/a'};
test('old reading backups stay compatible; new backups retain historical metadata and translations',()=>{
  const old={version:1,read:{},saved:{[row.id]:true},custom:[]};
  assert.deepEqual(Reading.backup(old),{articles:[],translations:[]});
  const restored=Reading.backup({...old,version:2,articles:[row],translations:[{source:row.abstract,text:'已缓存的译文'}]});
  assert.equal(restored.articles[0].archive_year,1980);
  assert.equal(restored.translations[0].source,row.abstract);
});
test('recent and historical saved records merge by canonical id without discarding cached abstracts',()=>{
  const recent={...row,id:'b'.repeat(64),archive:false,abstract:'',title:'Updated metadata'};
  const rows=Reading.merge([recent],[row],{[row.id]:recent.id});
  assert.equal(rows.length,1);assert.equal(rows[0].id,recent.id);
  assert.equal(rows[0].abstract,row.abstract);assert.equal(rows[0].title,'Updated metadata');
  const backwards=Reading.merge([],[recent,row],{[row.id]:recent.id});
  assert.equal(backwards[0].title,'Updated metadata');
});
test('malformed backup metadata or translations fail before importing any entries',()=>{
  const base={version:2,read:{},saved:{},custom:[]};
  assert.throws(()=>Reading.backup({...base,articles:[{...row,id:'invalid'}]}));
  assert.throws(()=>Reading.backup({...base,articles:[{...row,title:{html:'unsafe'}}]}));
  assert.throws(()=>Reading.backup({...base,translations:[{source:'a',text:[]}]}));
  assert.throws(()=>Reading.backup({...base,version:99}));
});

test('manual abstracts remain explicitly attributed through backup and feed refresh',()=>{
  assert.throws(()=>Reading.manual(row,'Too short.'));
  const text='An original abstract copied by the reader from the publisher page, preserved without generating any new claims.';
  const saved=Reading.manual(row,text);
  const restored=Reading.backup({version:2,read:{},saved:{[row.id]:true},custom:[],articles:[saved]}).articles;
  const merged=Reading.merge([{...row,abstract:''}],restored)[0];
  assert.equal(merged.abstract,text);assert.equal(merged.abstract_source,'手动摘录（未由来源接口核验）');
  assert.equal(merged.abstract_url,row.link);
});
