const test = require('node:test'),
  assert = require('node:assert/strict');
const B = require('./web/backup.js'),
  L = require('./web/library.js');
const state = { read: {}, saved: { ['a'.repeat(64)]: true }, folders: [], custom: ['0021-9010'] };
const journal = {
  id: '0021-9010',
  name: 'Journal of Applied Psychology',
  issns: ['0021-9010'],
  groups: [],
};
const article = {
  id: 'a'.repeat(64),
  journal_id: journal.id,
  title: 'Saved article',
  abstract: 'A saved abstract',
  citation: {
    title: 'Manual correction',
    authors: [{ family: 'Smith' }],
    year: '2026',
    manual: true,
  },
};
const library = {
  version: 1,
  journals: [journal],
  groups: [{ id: 'my-papers', name: 'My papers', journal_ids: [journal.id] }],
  deleted: [],
};

test('the live registry can be backed up despite malformed legacy secondary ISSNs', async () => {
  const registry = require('./journals.json');
  const manager = new L.Manager({ data: () => registry, desktop: true });
  manager.current = registry.groups;
  const portable = await L.validateBackup(manager.backup());
  assert.deepEqual(
    portable.journals.map((j) => j.id),
    registry.journals.map((j) => j.id),
  );
  assert.ok(portable.journals.find((j) => j.id === '1042-2587').issns.includes('1042-2587'));
});
test('one portable backup carries readings, citations, translations, journal groups and reading settings', async () => {
  const result = await B.create({
    state,
    articles: [article],
    library,
    autoTranslate: false,
    translator: { cached: async () => ({ text: '缓存译文' }) },
  });
  const restored = await B.parse(JSON.parse(JSON.stringify(result)), (x) => ({
    read: x.read,
    saved: x.saved,
    folders: x.folders,
    custom: x.custom,
  }));
  assert.equal(result.version, 4);
  assert.deepEqual(restored.state, state);
  assert.equal(restored.articles[0].citation.title, 'Manual correction');
  assert.equal(restored.translations[0].text, '缓存译文');
  assert.deepEqual(restored.library.groups, library.groups);
  assert.equal(restored.settings.auto_translate, false);
  assert.equal(JSON.stringify(result).includes('email'), false);
  assert.equal((await B.parse({ version: 1, ...state }, (x) => x)).library, null);
});
test('malformed configuration fails validation before import and incoming groups preserve destination edits', async () => {
  await assert.rejects(
    B.parse(
      {
        version: 4,
        ...state,
        articles: [article],
        library: { ...library, journals: [{ ...journal, issns: ['0000-0001'] }] },
      },
      (x) => x,
    ),
    /ISSN/,
  );
  const base = [{ id: 'seed', name: 'Seed', journal_ids: [] }];
  const current = {
    journals: [journal],
    groups: [{ id: 'my-papers', name: 'Destination name', journal_ids: [] }, ...base],
  };
  const combined = L.combineBackup(base, current, { ...library, deleted: ['seed'] });
  assert.deepEqual(combined.groups, [
    { id: 'my-papers', name: 'Destination name', journal_ids: [journal.id] },
  ]);
  const edited = L.combineBackup(
    base,
    { ...current, groups: [{ id: 'seed', name: 'Edited seed', journal_ids: [] }] },
    { ...library, groups: [], deleted: ['seed'] },
  );
  assert.equal(edited.groups[0].name, 'Edited seed');
});
test('ISSN aliases remap imported group membership without duplicating journals', () => {
  const alternate = { ...journal, id: '1939-1854', issns: ['1939-1854', '0021-9010'] };
  const result = L.combineBackup(
    [],
    { journals: [journal], groups: [] },
    {
      ...library,
      journals: [alternate],
      groups: [{ id: 'imported', name: 'Imported', journal_ids: [alternate.id] }],
    },
  );
  assert.equal(result.journals.length, 1);
  assert.equal(result.aliases[alternate.id], journal.id);
  assert.deepEqual(result.groups[0].journal_ids, [journal.id]);
});
