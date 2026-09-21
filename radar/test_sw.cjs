const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs');
test('offline upgrade caches the new entry and visited history without preloading all articles', async () => {
  const scope = 'https://example.test/radar/',
    events = {},
    stores = new Map();
  let offline = false;
  const requested = [];
  const key = (value) => new URL(typeof value === 'string' ? value : value.url, scope).href;
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        add: async (value) => {
          requested.push(key(value));
          store.set(key(value), new Response(key(value)));
        },
        addAll: async (values) => {
          for (const value of values) {
            requested.push(key(value));
            store.set(key(value), new Response(key(value)));
          }
        },
        put: async (request, response) => store.set(key(request), response),
        match: async (request) => store.get(key(request))?.clone(),
        keys: async () => [...store.keys()].map((url) => new Request(url)),
        delete: async (request) => store.delete(key(request)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (request) => {
      for (const store of stores.values())
        if (store.has(key(request))) return store.get(key(request)).clone();
    },
  };
  class ScopedRequest extends Request {
    constructor(url, opts) {
      super(key(url), opts);
    }
  }
  stores.set('journal-radar-shell-v18', new Map());
  const context = {
    URL,
    Request: ScopedRequest,
    Response,
    Promise,
    caches,
    JOURNAL_CATALOG: {},
    importScripts: () => {},
    fetch: async (req) => {
      if (offline) throw new Error('Offline');
      return new Response('cached article');
    },
    self: {
      location: { origin: 'https://example.test' },
      registration: { scope },
      addEventListener: (name, callback) => (events[name] = callback),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/web/sw.js', 'utf8'), context);
  let pending;
  events.install({ waitUntil: (p) => (pending = p) });
  await pending;
  assert.ok(requested.includes(scope + 'index.json'));
  assert.ok(requested.includes(scope + 'personal.js'));
  assert.equal(requested.includes(scope + 'data.json'), false);
  assert.equal(requested.includes(scope + 'citeproc.js'), false);
  events.activate({ waitUntil: (p) => (pending = p) });
  await pending;
  assert.equal(stores.has('journal-radar-shell-v18'), false);
  const url = scope + 'articles/' + 'a'.repeat(64) + '.json';
  const request = new Request(url);
  events.fetch({ request, respondWith: (p) => (pending = p) });
  assert.equal(await (await pending).text(), 'cached article');
  offline = true;
  events.fetch({ request, respondWith: (p) => (pending = p) });
  assert.equal(await (await pending).text(), 'cached article');
  events.fetch({
    request: new Request(scope + 'index.json?t=2'),
    respondWith: (p) => (pending = p),
  });
  assert.equal(await (await pending).text(), scope + 'index.json');
});
