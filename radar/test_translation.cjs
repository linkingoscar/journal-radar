const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Engine,splitText,LIMIT}=require('./web/translation.js');
const memory=()=>{const entries=new Map();return {async get(k){return structuredClone(entries.get(k));},async put(k,v){entries.set(k,structuredClone(v));}};};
const response=(text='中文译文')=>({ok:true,status:200,json:async()=>({responseStatus:200,responseData:{translatedText:text},quotaFinished:false})});

test('UTF-8 chunks preserve every source character within the provider byte limit',()=>{
  const source=('Employee well-being matters. 员工😀参与 and organizational performance! ').repeat(35);
  const chunks=splitText(source);
  assert.equal(chunks.join(''),source);
  assert(chunks.every(c=>Buffer.byteLength(c)<=450));
  const sentences='This is a complete first sentence. '+'A second sentence contains detailed findings about organizational behavior. '.repeat(9);
  assert(/[.!?]$/.test(splitText(sentences)[0]));
});

test('concurrent requests translate once; a new engine reuses the persisted full cache',async()=>{
  const store=memory();let calls=0;
  const fetcher=async()=>{calls++;return response();};
  const engine=new Engine({store,fetcher});
  const results=await Promise.all([engine.translate('An academic abstract.'),engine.translate('An academic abstract.')]);
  assert.equal(calls,1);assert.equal(results[0].text,'中文译文');assert.equal(results[1].cached,true);
  const restored=await new Engine({store,fetcher}).translate('An academic abstract.');
  assert.equal(restored.cached,true);assert.equal(calls,1);
});

test('quota blocks new requests but never blocks already cached translations',async()=>{
  const store=memory();let calls=0;const clock=()=>100000000;
  const engine=new Engine({store,clock,fetcher:async()=>{calls++;return response();}});
  await engine.translate('Previously translated abstract.');
  await store.put('usage',[{at:clock(),chars:LIMIT}]);
  await assert.rejects(engine.translate('A new abstract.'),/额度不足/);
  assert.equal((await engine.translate('Previously translated abstract.')).cached,true);assert.equal(calls,1);
});

test('a failed segment is not cached as a translation; retry resumes completed segments',async()=>{
  const store=memory();let calls=0;
  const source='A substantive sentence about employee motivation and performance. '.repeat(10);
  const engine=new Engine({store,fetcher:async()=>{calls++;return calls===2?{ok:true,json:async()=>({responseStatus:429,quotaFinished:true})}:response('员工动机与绩效。');}});
  await assert.rejects(engine.translate(source),/额度已用完/);
  const result=await engine.translate(source);
  assert(result.text.includes('员工动机与绩效'));assert.equal(calls,splitText(source.trim()).length+1);
});

test('an already cancelled reader consumes no provider quota',async()=>{
  const store=memory();let calls=0;
  const controller=new AbortController();controller.abort();
  const engine=new Engine({store,fetcher:async()=>{calls++;return response();}});
  await assert.rejects(engine.translate('An abstract.',{signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,0);assert.equal(await store.get('usage'),undefined);
});

test('provider quota warnings inside translatedText are never saved as translations',async()=>{
  const store=memory();let calls=0;
  const engine=new Engine({store,fetcher:async()=>response(++calls===1?'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 12 HOURS.':'正常译文')});
  await assert.rejects(engine.translate('A short abstract.'),/额度已用完/);
  assert.equal((await engine.translate('A short abstract.')).text,'正常译文');
  assert.equal(calls,2);
});
