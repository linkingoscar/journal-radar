importScripts('catalog.js');
const SHELL = 'journal-radar-shell-v25',
  DATA = 'journal-radar-data-v2';
const FILES = [
  './',
  'index.html',
  'style.css',
  'enhancements.css',
  'translation.js',
  'catalog.js',
  'reading.js',
  'state.js',
  'personal.js',
  'data.js',
  'feed.js',
  'archives.js',
  'library.js',
  'backup.js',
  'citations.js',
  'favorites.js',
  'apa.csl',
  'locales-en-US.xml',
  'app.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'manifest.webmanifest',
  ...Object.values(JOURNAL_CATALOG)
    .map((j) => j.cover)
    .filter(Boolean),
];
self.addEventListener('install', (event) =>
  event.waitUntil(
    Promise.all([
      caches
        .open(SHELL)
        .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))),
      caches.open(DATA).then((cache) => cache.add('index.json')),
    ]).then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('journal-radar-') && ![SHELL, DATA].includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (url.pathname.endsWith('/index.json')) {
    const key = new URL('index.json', self.registration.scope).href;
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (!response.ok) throw new Error('Unavailable');
          const cache = await caches.open(DATA);
          await cache.put(key, response.clone());
          return response;
        })
        .catch(() =>
          caches
            .open(DATA)
            .then((cache) => cache.match(key))
            .then((response) => response || Response.error()),
        ),
    );
  } else {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(async (response) => {
          if (!response.ok) throw new Error('Unavailable');
          if (url.pathname.endsWith('/citeproc.js')) {
            const cache = await caches.open(SHELL);
            await cache.put(event.request, response.clone());
          }
          if (/\/articles\/[a-f0-9]{64}\.json$/.test(url.pathname)) {
            const cache = await caches.open(DATA);
            await cache.put(event.request, response.clone());
            const keys = (await cache.keys()).filter((k) =>
              new URL(k.url).pathname.includes('/articles/'),
            );
            await Promise.all(
              keys.slice(0, Math.max(0, keys.length - 80)).map((key) => cache.delete(key)),
            );
          }
          return response;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then(
              (response) =>
                response ||
                (event.request.mode === 'navigate' ? caches.match('./') : Response.error()),
            ),
        ),
    );
  }
});
