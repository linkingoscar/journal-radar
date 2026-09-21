const test = require('node:test'),
  assert = require('node:assert/strict');
const { Library } = require('./web/data.js');
const id = (i) => i.toString(16).padStart(64, '0');
const chunk = (i, journal) => ({
  url: 'articles/' + id(i) + '.json',
  journal_id: journal,
  count: 1,
});

test('new-discovery history skips older and equal instants but keeps unknown bounds and other modes complete', async () => {
  const chunks = [
    { ...chunk(1, 'one'), first_seen_max: '2026-09-21T09:59:00+08:00' },
    { ...chunk(2, 'one'), first_seen_max: '2026-09-21T02:00:00Z' },
    { ...chunk(3, 'one'), first_seen_max: '2026-09-21T10:01:00+08:00' },
    chunk(4, 'one'),
    { ...chunk(5, 'one'), first_seen_max: 'invalid' },
    chunk(6, 'two'),
  ];
  const requested = [];
  const library = new Library(async (url) => ({
    ok: true,
    json: async () => {
      if (url.startsWith('index.json'))
        return { articles: [], journals: [], history_chunks: chunks };
      requested.push(url);
      return { articles: [{ id: url.slice(9, -5), journal_id: 'one' }] };
    },
  }));
  await library.refresh();
  const ids = new Set(['one']);
  const since = '2026-09-21T10:00:00+08:00';
  assert.equal(library.pending(ids).length, 5);
  assert.equal(library.pending(ids, 'invalid').length, 5);
  const rows = await library.history(ids, () => {}, { since });
  assert.deepEqual(rows.map((a) => a.id).sort(), [id(3), id(4), id(5)]);
  assert.deepEqual(
    requested.sort(),
    chunks.slice(2, 5).map((c) => c.url),
  );
  assert.equal(library.pending(ids, since).length, 0);
  assert.equal(library.pending(ids).length, 2);
  assert.equal((await library.history(ids)).length, 5);
});
test('history fetches at most three chunks concurrently and reports completion without losing rows', async () => {
  const chunks = Array.from({ length: 8 }, (_, i) => chunk(i + 1, 'one'));
  let active = 0,
    maximum = 0;
  const progress = [];
  const library = new Library(async (url) => {
    if (url.startsWith('index.json'))
      return {
        ok: true,
        json: async () => ({ journals: [], articles: [], history_chunks: chunks }),
      };
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return {
      ok: true,
      json: async () => ({ articles: [{ id: url.slice(9, -5), journal_id: 'one' }] }),
    };
  });
  await library.refresh();
  const rows = await library.history(new Set(['one']), (done, total) =>
    progress.push([done, total]),
  );
  assert.equal(maximum, 3);
  assert.equal(new Set(rows.map((a) => a.id)).size, 8);
  assert.deepEqual(progress.at(-1), [8, 8]);
});
test('cancelling one scope stops its requests and lets a new scope finish independently', async () => {
  const chunks = [...Array.from({ length: 6 }, (_, i) => chunk(i + 1, 'old')), chunk(7, 'new')];
  const requested = [];
  const library = new Library(async (url, options) => {
    if (url.startsWith('index.json'))
      return {
        ok: true,
        json: async () => ({ journals: [], articles: [], history_chunks: chunks }),
      };
    requested.push(url);
    if (url !== chunks[6].url)
      await new Promise((resolve, reject) =>
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        }),
      );
    return { ok: true, json: async () => ({ articles: [{ id: id(7), journal_id: 'new' }] }) };
  });
  await library.refresh();
  const controller = new AbortController();
  const previous = library.history(new Set(['old']), () => {}, { signal: controller.signal });
  const rejection = assert.rejects(previous, { name: 'AbortError' });
  controller.abort();
  const rows = await library.history(new Set(['new']));
  await rejection;
  assert.deepEqual(
    rows.map((a) => a.id),
    [id(7)],
  );
  assert.equal(requested.length, 4);
  assert.equal(library.pending(new Set(['old'])).length, 6);
});
test('recent feed is independent of history and loads only the requested journals', async () => {
  const calls = [],
    one = chunk(1, 'one'),
    two = chunk(2, 'two');
  const library = new Library(async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () =>
        url.startsWith('index.json')
          ? { articles: [{ id: id(3) }], journals: [], history_chunks: [one, two] }
          : { articles: [{ id: id(1), journal_id: 'one' }] },
    };
  });
  assert.equal((await library.refresh()).articles.length, 1);
  assert.equal(calls.length, 1);
  const rows = await library.history(new Set(['one']));
  assert.equal(rows.length, 2);
  assert.equal(calls[1], one.url);
  await library.history(new Set(['one']));
  assert.equal(calls.length, 2);
  assert.equal(library.pending(new Set(['two'])).length, 1);
});
test('failed history preserves the current feed and a retry reuses successful chunks', async () => {
  let fail = true,
    calls = 0;
  const chunks = [chunk(1, 'one'), chunk(2, 'one')];
  const library = new Library(async (url) => {
    if (url.startsWith('index.json'))
      return {
        ok: true,
        json: async () => ({ journals: [], articles: [], history_chunks: chunks }),
      };
    calls++;
    return {
      ok: !(url === chunks[1].url && fail),
      status: 503,
      json: async () => ({
        articles: [{ id: url === chunks[0].url ? id(1) : id(2), journal_id: 'one' }],
      }),
    };
  });
  await library.refresh();
  await assert.rejects(library.history(new Set(['one'])), /503/);
  assert.equal(library.rows.size, 0);
  fail = false;
  assert.equal((await library.history(new Set(['one']))).length, 2);
  assert.equal(calls, 3);
});
test('refresh prevents an older in-flight history request from overwriting a new generation', async () => {
  let finish;
  const c = chunk(1, 'one');
  let generation = 0;
  const library = new Library(async (url) => ({
    ok: true,
    json: () =>
      url.startsWith('index.json')
        ? { journals: [], articles: [{ id: id(++generation) }], history_chunks: [c] }
        : new Promise((resolve) => {
            finish = resolve;
          }),
  }));
  await library.refresh();
  const old = library.history(new Set(['one']));
  await new Promise((resolve) => setImmediate(resolve));
  await library.refresh();
  finish({ articles: [{ id: id(5), journal_id: 'one' }] });
  assert.equal(await old, null);
  assert.deepEqual([...library.rows.keys()], [id(2)]);
});
