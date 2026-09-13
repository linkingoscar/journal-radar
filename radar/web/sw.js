const SHELL='journal-radar-shell-v5', DATA='journal-radar-data-v1';
const FILES=['./','index.html','style.css','enhancements.css','translation.js','app.js','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(Promise.all([caches.open(SHELL).then(cache=>cache.addAll(FILES)),caches.open(DATA).then(cache=>cache.add('data.json'))]).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('journal-radar-')&&![SHELL,DATA].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(url.pathname.endsWith('/data.json')){
    const key=new URL('data.json',self.registration.scope).href;
    event.respondWith(fetch(event.request).then(async response=>{if(!response.ok)throw new Error('Unavailable');const cache=await caches.open(DATA);await cache.put(key,response.clone());return response;}).catch(()=>caches.open(DATA).then(cache=>cache.match(key)).then(response=>response||Response.error())));
  }else{
    event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(response=>response||(event.request.mode==='navigate'?caches.match('./'):Response.error()))));
  }
});
