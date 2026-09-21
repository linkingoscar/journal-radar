const test = require('node:test'),
  assert = require('node:assert/strict');
const Filters = require('./web/filters.js'),
  Personal = require('./web/personal.js');
const { Sync } = require('./web/state.js');
const Reading = require('./web/reading.js');
const Notes = require('./web/notes.js');
test('upgrading stored readings keeps existing bookmarks and blocks legacy clients from erasing notes', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const previous = global.indexedDB;
  global.indexedDB = new IDBFactory();
  try {
    const old = await new Promise((resolve, reject) => {
      const request = indexedDB.open('journal-radar-reading-state', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const id = 'c'.repeat(64);
    await new Promise((resolve, reject) => {
      const tx = old.transaction('state', 'readwrite');
      tx.objectStore('state').put(
        { ...empty, saved: { [id]: true }, read: { [id]: true } },
        'reading',
      );
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    let oldClosed = false;
    old.onversionchange = () => {
      oldClosed = true;
      old.close();
    };
    const normalize = (value) => ({
      ...empty,
      ...value,
      annotations: Notes.records(value.annotations),
      queries: Filters.records(value.queries),
    });
    const upgraded = new Sync({ initial: empty, normalize });
    await upgraded.flush();
    assert.equal(upgraded.current.saved[id], true);
    assert.equal(upgraded.current.read[id], true);
    const note = {
      note: 'Keep this research note',
      tags: ['leadership'],
      updated_at: new Date().toISOString(),
    };
    await upgraded.editRecord('annotations', id, null, note);
    await upgraded.editRecord('queries', filterId, null, filter);
    assert.equal(oldClosed, true);
    await assert.rejects(
      new Promise((resolve, reject) => {
        const request = indexedDB.open('journal-radar-reading-state', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      }),
      { name: 'VersionError' },
    );
    const reopened = new Sync({ initial: empty, normalize });
    await reopened.flush();
    assert.deepEqual(reopened.current.annotations[id], note);
    assert.deepEqual(reopened.current.queries[filterId], filter);
    assert.equal(reopened.current.saved[id], true);
  } finally {
    global.indexedDB = previous;
  }
});
test('RIS and BibTeX export structured authors, pages, notes and warnings without inventing metadata', () => {
  const C = require('./web/citations.js'),
    id = 'a'.repeat(64);
  const citation = {
    title: 'Teams & {AI}: 50% of A_B',
    journal: 'Journal of Research',
    authors: [{ family: 'Smith', given: 'Alex' }, { literal: '研究团队' }],
    year: '2026',
    volume: '12',
    issue: '3',
    pages: '121–130',
    doi: '10.1000/example',
  };
  const rows = [
    { id, citation, abstract: 'A complete abstract.' },
    { id: 'duplicate', citation: { ...citation, doi: 'https://doi.org/10.1000/EXAMPLE' } },
  ];
  const notes = { [id]: { note: '研究笔记\nER  - malicious delimiter', tags: ['领导力', '方法'] } };
  const ris = C.exportRecords(rows, 'ris', notes),
    fields = {};
  for (const line of ris.trimEnd().split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9]{2})  -(?: (.*))?$/);
    assert.ok(match, line);
    (fields[match[1]] ||= []).push(match[2] || '');
  }
  assert.deepEqual(fields.TY, ['JOUR']);
  assert.deepEqual(fields.ER, ['']);
  assert.deepEqual(fields.AU, ['Smith, Alex', '研究团队']);
  assert.deepEqual(fields.SP, ['121']);
  assert.deepEqual(fields.EP, ['130']);
  assert.deepEqual(fields.KW, ['领导力', '方法']);
  assert.equal(fields.N1[0], '研究笔记 ER - malicious delimiter');
  const bib = C.exportRecords(rows, 'bib', notes);
  assert.equal((bib.match(/@article\{/g) || []).length, 1);
  assert.ok(bib.includes('title = {Teams \\& \\{AI\\}: 50\\% of A\\_B}'));
  assert.ok(bib.includes('author = {Smith, Alex and {研究团队}}'));
  assert.ok(bib.includes('pages = {121--130}') && bib.includes('keywords = {领导力, 方法}'));
  const incomplete = C.exportRecords(
    [{ id, citation: { ...citation, authors: [], year: '', pages: '', article_number: 'e102' } }],
    'ris',
  );
  assert.ok(!incomplete.includes('AU  -') && !incomplete.includes('PY  -'));
  assert.ok(incomplete.includes('N1  - 待核对：') && incomplete.includes('SP  - e102'));
  const comparisons = { [id]: { note: 'p < .05 and t > 2; keep <model A>', tags: ['p < .05'] } };
  for (const format of ['ris', 'bib']) {
    const exported = C.exportRecords(rows, format, comparisons);
    assert.ok(exported.includes('p < .05 and t > 2; keep <model A>'));
    assert.ok(exported.includes('p < .05'));
  }
});

test('v5 carries real PNG covers while v4 remains readable; malformed and orphan covers fail early', async () => {
  const fs = require('node:fs'),
    B = require('./web/backup.js'),
    Covers = require('./web/covers.js');
  const row = {
    journal_id: '0022-3514',
    data: fs.readFileSync(__dirname + '/web/cover-0022-3514.png').toString('base64'),
  };
  const payload = await B.create({
    state: empty,
    articles: [],
    library: {
      version: 1,
      journals: [
        {
          id: row.journal_id,
          name: 'Journal of Personality and Social Psychology',
          issns: [row.journal_id],
        },
      ],
      groups: [],
      deleted: [],
    },
    autoTranslate: false,
    translator: { cached: async () => null },
    covers: [row],
  });
  const restored = await B.parse(JSON.parse(JSON.stringify(payload)), (s) => s);
  assert.equal(payload.version, 5);
  assert.deepEqual(restored.covers, [row]);
  assert.deepEqual(
    (await B.parse({ ...payload, version: 4, covers: undefined }, (s) => s)).covers,
    [],
  );
  assert.throws(() => Covers.records([{ ...row, data: 'a'.repeat(100) }]), /PNG/);
  assert.throws(() => Covers.records([row, row]), /格式/);
  await assert.rejects(
    B.parse({ ...payload, covers: [{ ...row, journal_id: '0021-9010' }] }, (s) => s),
    /对应期刊/,
  );
});
test('notes are independent of collected metadata, searchable, and merge without losing either draft', async () => {
  const id = 'a'.repeat(64),
    alias = 'b'.repeat(64);
  const first = {
    note: '用于论文的理论部分',
    tags: ['领导力'],
    updated_at: '2026-09-21T00:00:00Z',
  };
  const second = {
    note: '补充实验方法',
    tags: ['实验', '领导力'],
    updated_at: '2026-09-22T00:00:00Z',
  };
  const merged = Notes.merge({ [id]: first }, { [alias]: second }, { [alias]: id });
  assert.ok(merged[id].note.includes(first.note) && merged[id].note.includes(second.note));
  assert.deepEqual(merged[id].tags, ['领导力', '实验']);
  assert.deepEqual(Notes.merge(merged, { [alias]: second }, { [alias]: id }), merged);
  assert.throws(() => Notes.records({ [id]: { ...first, tags: ['x'.repeat(41)] } }), /格式/);
  const article = {
    id,
    journal_id: '0021-9010',
    title: 'An ordinary title',
    first_seen: '2026-09-21T00:00:00Z',
  };
  const state = { ...empty, annotations: merged };
  const selected = require('./web/feed.js').select([article], { state, query: '理论' });
  assert.equal(selected.articles[0].id, id);
  const B = require('./web/backup.js');
  const remapped = B.remapPreferences(
    { route: '#journal=1939-1854', journal: '1939-1854', period: '7' },
    { '1939-1854': '0021-9010' },
  );
  assert.equal(remapped.journal, '0021-9010');
  assert.equal(remapped.route, '#journal=0021-9010');
  const backup = await B.create({
    state,
    articles: [article],
    library: {
      version: 1,
      journals: [{ id: '0021-9010', name: 'Journal of Applied Psychology', issns: ['0021-9010'] }],
      groups: [],
      deleted: [],
    },
    autoTranslate: false,
    translator: { cached: async () => null },
  });
  const restored = await B.parse(JSON.parse(JSON.stringify(backup)), (s) => ({
    ...empty,
    annotations: Notes.records(s.annotations),
  }));
  assert.deepEqual(restored.state.annotations, merged);
  assert.equal(restored.articles[0].title, article.title);
});
test('continuous reading retains the opening order as unread rows disappear, with bounded navigation', () => {
  const a = { id: 'a' },
    b = { id: 'b' },
    c = { id: 'c' },
    visible = [a, b, c];
  const sequence = new Reading.Sequence();
  sequence.start(a, visible);
  visible.shift();
  assert.equal(sequence.move(-1), null);
  assert.equal(sequence.move(1).id, 'b');
  visible.shift();
  assert.equal(sequence.move(1).id, 'c');
  assert.equal(sequence.move(1), null);
  assert.equal(sequence.move(-1).id, 'b');
  sequence.start({ id: 'direct-link' }, visible);
  assert.equal(sequence.rows.length, 1);
  assert.equal(sequence.move(1), null);
});
const empty = { read: {}, saved: {}, folders: [], custom: [], queries: {} };
const filterId = 'filter-' + 'a'.repeat(36);
const filter = {
  name: '每周未读',
  preferences: Personal.preferences({
    route: '#feed=hr35',
    view: 'unread',
    period: '7',
    search: 'leadership',
  }),
};

test('saved filters retain independent criteria and reject invalid routes in backups', async () => {
  const clean = Filters.records({ [filterId]: filter });
  assert.equal(clean[filterId].preferences.period, '7');
  assert.equal(clean[filterId].preferences.view, 'unread');
  assert.equal(clean[filterId].preferences.search, 'leadership');
  assert.throws(
    () =>
      Filters.records({ [filterId]: { ...filter, preferences: { route: 'https://bad.test' } } }),
    /格式/,
  );
  const B = require('./web/backup.js');
  const backup = await B.create({
    state: { ...empty, queries: clean },
    articles: [],
    library: { version: 1, journals: [], groups: [], deleted: [] },
    autoTranslate: false,
    translator: { cached: async () => null },
  });
  const restored = await B.parse(backup, (value) => ({
    ...empty,
    queries: Filters.records(value.queries),
  }));
  assert.deepEqual(restored.state.queries, clean);
  const old = await B.parse({ version: 1, ...empty }, (value) => ({
    ...empty,
    queries: Filters.records(value.queries),
  }));
  assert.deepEqual(old.state.queries, {});
});

test('personal edits merge across windows and stale edits preserve the newer record', async () => {
  let stored,
    tail = Promise.resolve();
  const commit = (update) =>
    (tail = tail
      .catch(() => {})
      .then(() => {
        stored = structuredClone(update(stored));
        return structuredClone(stored);
      }));
  const normalize = (value) => ({
    ...empty,
    ...structuredClone(value),
    queries: Filters.records(value.queries),
  });
  const a = new Sync({ initial: empty, normalize, commit }),
    b = new Sync({ initial: empty, normalize, commit });
  await Promise.all([
    a.editRecord('queries', filterId, null, filter),
    b.editRecord('queries', 'filter-' + 'b'.repeat(36), null, { ...filter, name: '另一组' }),
  ]);
  assert.equal(Object.keys(stored.queries).length, 2);
  await a.flush();
  await b.flush();
  const original = structuredClone(a.current.queries[filterId]);
  await a.editRecord('queries', filterId, original, { ...original, name: '已修改' });
  await assert.rejects(
    b.editRecord('queries', filterId, original, { ...original, name: '过期编辑' }),
    /其他窗口/,
  );
  await b.save({ ...b.current, read: { ['f'.repeat(64)]: true } });
  assert.equal(stored.queries[filterId].name, '已修改');
  assert.equal(stored.read['f'.repeat(64)], true);
});
