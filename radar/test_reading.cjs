const test = require('node:test'),
  assert = require('node:assert/strict');
const Reading = require('./web/reading.js');
const { Sync } = require('./web/state.js');
const row = {
  id: 'a'.repeat(64),
  journal_id: '0021-9010',
  title: 'A historical paper',
  doi: '10.1000/a',
  archive: true,
  archive_year: 1980,
  abstract: 'An abstract preserved in a backup',
  link: 'https://doi.org/10.1000/a',
};
test('old reading backups stay compatible; new backups retain historical metadata and translations', () => {
  const old = { version: 1, read: {}, saved: { [row.id]: true }, custom: [] };
  assert.deepEqual(Reading.backup(old), { articles: [], translations: [] });
  const restored = Reading.backup({
    ...old,
    version: 2,
    articles: [row],
    translations: [{ source: row.abstract, text: '已缓存的译文' }],
  });
  assert.equal(restored.articles[0].archive_year, 1980);
  assert.equal(restored.translations[0].source, row.abstract);
});
test('recent and historical saved records merge by canonical id without discarding cached abstracts', () => {
  const recent = {
    ...row,
    id: 'b'.repeat(64),
    archive: false,
    abstract: '',
    title: 'Updated metadata',
  };
  const rows = Reading.merge([recent], [row], { [row.id]: recent.id });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, recent.id);
  assert.equal(rows[0].abstract, row.abstract);
  assert.equal(rows[0].title, 'Updated metadata');
  const backwards = Reading.merge([], [recent, row], { [row.id]: recent.id });
  assert.equal(backwards[0].title, 'Updated metadata');
});
test('malformed backup metadata or translations fail before importing any entries', () => {
  const base = { version: 2, read: {}, saved: {}, custom: [] };
  assert.throws(() => Reading.backup({ ...base, articles: [{ ...row, id: 'invalid' }] }));
  assert.throws(() =>
    Reading.backup({ ...base, articles: [{ ...row, title: { html: 'unsafe' } }] }),
  );
  assert.throws(() => Reading.backup({ ...base, translations: [{ source: 'a', text: [] }] }));
  assert.throws(() => Reading.backup({ ...base, version: 99 }));
});

test('manual abstracts remain explicitly attributed through backup and feed refresh', () => {
  assert.throws(() => Reading.manual(row, 'Too short.'));
  const text =
    'An original abstract copied by the reader from the publisher page, preserved without generating any new claims.';
  const saved = Reading.manual(row, text);
  const restored = Reading.backup({
    version: 2,
    read: {},
    saved: { [row.id]: true },
    custom: [],
    articles: [saved],
  }).articles;
  const merged = Reading.merge([{ ...row, abstract: '' }], restored)[0];
  assert.equal(merged.abstract, text);
  assert.equal(merged.abstract_source, '手动摘录（未由来源接口核验）');
  assert.equal(merged.abstract_url, row.link);
});

function sharedReading(initial = { read: {}, saved: {}, custom: [], folders: [] }) {
  let stored,
    queue = Promise.resolve(),
    fail = false;
  const commit = (update) => {
    const result = queue
      .catch(() => {})
      .then(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        if (fail) {
          fail = false;
          throw new Error('Storage unavailable');
        }
        stored = structuredClone(update(stored));
        return structuredClone(stored);
      });
    queue = result;
    return result;
  };
  const tab = () =>
    new Sync({
      initial,
      commit,
      normalize: (s) => ({ ...structuredClone(s), folders: Reading.folders(s.folders, s.saved) }),
    });
  return {
    tab,
    stored: () => stored,
    fail: () => {
      fail = true;
    },
  };
}
test('checkpoints merge across scopes and an older tab cannot move a check backwards', async () => {
  const shared = sharedReading(),
    a = shared.tab(),
    b = shared.tab();
  await Promise.all([
    a.save({ ...a.current, checked: { 'group:hr35': '2026-09-21T00:00:00Z' } }),
    b.save({ ...b.current, checked: { 'journal:0021-9010': '2026-09-20T00:00:00Z' } }),
  ]);
  await a.save({ ...a.current, checked: { 'group:hr35': '2026-09-19T00:00:00Z' } });
  assert.equal(shared.stored().checked['group:hr35'], '2026-09-21T00:00:00Z');
  assert.equal(shared.stored().checked['journal:0021-9010'], '2026-09-20T00:00:00Z');
});

test('independent tabs concurrently save different articles and preserve read and custom changes', async () => {
  const shared = sharedReading(),
    a = shared.tab(),
    b = shared.tab();
  const first = structuredClone(a.current),
    second = structuredClone(b.current),
    other = 'b'.repeat(64);
  first.saved[row.id] = true;
  first.read[row.id] = true;
  first.custom = ['0021-9010'];
  second.saved[other] = true;
  await Promise.all([a.save(first), b.save(second)]);
  await a.flush();
  await b.flush();
  assert.deepEqual(Object.keys(a.current.saved).sort(), [row.id, other]);
  assert.deepEqual(a.current, b.current);
  assert.equal(shared.stored().read[row.id], true);
  assert.deepEqual(shared.stored().custom, ['0021-9010']);
});

test('a stale tab cannot resurrect an unsaved article or deleted folder by editing another field', async () => {
  const other = 'b'.repeat(64),
    shared = sharedReading({
      read: {},
      saved: { [row.id]: true, [other]: true },
      custom: [],
      folders: [{ id: 'folder-one', name: 'Original', articles: [row.id] }],
    });
  const a = shared.tab(),
    b = shared.tab();
  await a.flush();
  const removed = structuredClone(a.current);
  delete removed.saved[row.id];
  removed.folders = [];
  const stale = structuredClone(b.current);
  stale.read[other] = true;
  stale.folders[0].articles.push(other);
  await Promise.all([a.save(removed), b.save(stale)]);
  assert.equal(shared.stored().saved[row.id], undefined);
  assert.equal(shared.stored().read[other], true);
  assert.deepEqual(shared.stored().folders, []);
});

test('folder renames and independent membership edits merge while removals stay removed', async () => {
  const other = 'b'.repeat(64),
    shared = sharedReading({
      read: {},
      saved: { [row.id]: true, [other]: true },
      custom: [],
      folders: [{ id: 'folder-one', name: 'Original', articles: [row.id] }],
    });
  const a = shared.tab(),
    b = shared.tab();
  const first = structuredClone(a.current),
    second = structuredClone(b.current);
  first.folders[0].name = 'Renamed';
  first.folders[0].articles = [];
  second.folders[0].articles.push(other);
  await Promise.all([a.save(first), b.save(second)]);
  assert.deepEqual(shared.stored().folders, [
    { id: 'folder-one', name: 'Renamed', articles: [other] },
  ]);
});

test('failed saves retain pending operations for retry and rapid save/unsave ends unsaved', async () => {
  const shared = sharedReading(),
    a = shared.tab();
  shared.fail();
  await assert.rejects(a.save({ ...a.current, saved: { [row.id]: true } }), /Storage unavailable/);
  await a.flush();
  assert.equal(shared.stored().saved[row.id], true);
  const unset = a.save({ ...a.current, saved: {} });
  const reset = a.save({ ...a.current, saved: { [row.id]: true } });
  const final = a.save({ ...a.current, saved: {} });
  await Promise.all([unset, reset, final]);
  assert.deepEqual(shared.stored().saved, {});
});
