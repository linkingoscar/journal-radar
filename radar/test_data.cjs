const test = require('node:test'),
  assert = require('node:assert/strict');
const { Library } = require('./web/data.js');
const id = (i) => i.toString(16).padStart(64, '0');
const chunk = (i, journal) => ({
  url: 'articles/' + id(i) + '.json',
  journal_id: journal,
  count: 1,
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
