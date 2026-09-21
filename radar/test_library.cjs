const test = require('node:test'),
  assert = require('node:assert/strict');
const { validate, merge, Manager } = require('./web/library.js');
const reading = require('./web/reading.js');
test('personal groups support overlapping membership and reject unknown journals and duplicate names', () => {
  const ids = new Set(['0093-5301', 'rss-0123456789abcdef']);
  const groups = validate(
    [
      { id: 'g-one', name: '第一组', journal_ids: [...ids] },
      { id: 'g-two', name: '第二组', journal_ids: ['0093-5301'] },
    ],
    ids,
  );
  assert.equal(groups[0].journal_ids[0], groups[1].journal_ids[0]);
  assert.throws(
    () => validate([...groups, { id: 'g-three', name: ' 第一组 ', journal_ids: [] }], ids),
    /重复/,
  );
  assert.throws(
    () => validate([{ id: 'g-one', name: '研究', journal_ids: ['missing'] }], ids),
    /尚未添加/,
  );
});
test('local renamed and removed seed groups survive reload while future seed groups remain visible', () => {
  const base = [
    { id: 'marketing', name: 'Marketing', journal_ids: ['0093-5301'] },
    { id: 'future', name: 'Future', journal_ids: [] },
  ];
  const local = { groups: [{ id: 'marketing', name: '消费者', journal_ids: [] }], deleted: [] };
  assert.equal(merge(base, local)[0].name, '消费者');
  assert.deepEqual(
    merge(base, { ...local, deleted: ['marketing'] }).map((g) => g.id),
    ['future'],
  );
  const manager = new Manager({ desktop: true }),
    payload = {
      groups: [local.groups[0]],
      journals: [{ id: '0093-5301', groups: ['ft50', 'marketing'] }],
    };
  manager.apply(payload);
  assert.deepEqual(payload.journals[0].groups, ['ft50']);
  assert.equal(manager.label('marketing'), '消费者');
  assert.equal(manager.has('missing'), false);
});
test('RSS-only article metadata can be backed up and restored', () => {
  const article = {
    id: 'a'.repeat(64),
    journal_id: 'rss-0123456789abcdef',
    title: 'Research from RSS',
    abstract: 'An abstract',
    link: 'https://example.org/paper',
  };
  const backup = reading.backup({
    version: 2,
    read: {},
    saved: { [article.id]: true },
    custom: [article.journal_id],
    articles: [article],
  });
  assert.equal(backup.articles[0].journal_id, article.journal_id);
  assert.throws(() => reading.article({ ...article, journal_id: 'rss-invalid' }));
});
test('saving an open editor keeps its original revision after background refresh', async () => {
  const payload = { journals: [{ id: '0093-5301' }], library_revision: 'original' };
  const manager = new Manager({ desktop: true, data: () => payload, reload: async () => {} }),
    opened = manager.version();
  payload.library_revision = 'newer';
  let submitted;
  manager.request = async (_path, body) => {
    submitted = body;
  };
  await manager.save([{ id: 'g-one', name: 'Research', journal_ids: ['0093-5301'] }], opened);
  assert.equal(submitted.revision, 'original');
});
