const test = require('node:test'),
  assert = require('node:assert/strict');
const Feed = require('./web/feed.js');
const state = { read: {}, saved: {} };
const old = {
  id: 'old',
  journal_id: 'one',
  title: 'Older discovery',
  first_seen: '2026-09-13T00:00:00Z',
  published_date: '2027-03',
  print_date: '2027-03',
};
const recent = {
  id: 'new',
  journal_id: 'one',
  title: 'New discovery',
  first_seen: '2026-09-19T00:00:00Z',
  published_date: '2026-09-18',
};

test('recent discoveries lead future issues without deleting or inventing publication dates', () => {
  const rows = [old, recent];
  assert.deepEqual(
    Feed.select(rows, { state, today: '2026-09-20' }).articles.map((a) => a.id),
    ['new', 'old'],
  );
  assert.deepEqual(
    Feed.select(rows, { state, today: '2026-09-20', sort: 'published' }).articles.map((a) => a.id),
    ['new', 'old'],
  );
  assert.equal(Feed.dateLabel(old, '2026-09-20'), '预排刊期 2027.03');
  assert.equal(old.published_date, '2027-03');
  assert.equal(
    Feed.publicationDate({ ...old, online_date: '2026-09-18' }, '2026-09-20'),
    '2026-09-18',
  );
  assert.equal(Feed.future('2026-09', '2026-09-20'), false);
});

test('time filters use the selected date basis and retain overlapping month/year precision', () => {
  const delayed = { ...old, published_date: '2020-01', first_seen: '2026-09-19T00:00:00Z' };
  assert.equal(Feed.select([delayed], { state, cutoff: '2026-09-01' }).total, 1);
  assert.equal(Feed.select([delayed], { state, cutoff: '2026-09-01', sort: 'published' }).total, 0);
  for (const date of ['2026', '2026-09'])
    assert.equal(
      Feed.select([{ ...recent, published_date: date }], {
        state,
        cutoff: '2026-09-15',
        sort: 'published',
        today: '2026-09-20',
      }).total,
      1,
    );
});

test('coverage follows journal, dates, search, reading and folders before abstract filtering', () => {
  const rows = [
    { ...old, abstract: '' },
    { ...recent, abstract: '= 37,105). A remaining fragment.' },
    { ...recent, id: 'complete', abstract: 'A short but intact abstract.' },
    { ...recent, id: 'other-journal', journal_id: 'two', abstract: '' },
  ];
  const options = {
    state,
    journal: 'one',
    today: '2026-09-20',
    cutoff: '2026-09-15',
    abstract: 'missing',
  };
  const result = Feed.select(rows, options);
  assert.equal(result.total, 2);
  assert.equal(result.missing, 0);
  assert.equal(result.suspect, 1);
  assert.deepEqual(
    result.articles.map((a) => a.id),
    ['new'],
  );
  assert.equal(
    Feed.select(rows, { ...options, state: { read: { new: true }, saved: {} }, view: 'unread' })
      .suspect,
    0,
  );
  assert.equal(Feed.select(rows, { ...options, matches: (a) => a.id === 'complete' }).total, 1);
  assert.equal(Feed.select(rows, { ...options, query: 'does not match' }).total, 0);
});

test('obvious fragments remain inspectable and distinct from absent or intact short abstracts', () => {
  for (const text of [
    '= 37,105). The remainder of the abstract.',
    'An interrupted abstract...',
    '…the remaining results.',
  ]) {
    const info = Feed.abstractInfo({ abstract: text });
    assert.equal(info.status, 'suspect');
    assert.equal(info.text, text);
  }
  assert.equal(
    Feed.abstractInfo({ abstract: 'Results differed (p < .05), with an effect > 0.' }).status,
    'available',
  );
  assert.equal(Feed.abstractInfo({ abstract: 'A short, intact abstract.' }).status, 'available');
  assert.equal(Feed.abstractInfo({ abstract: 'No abstract available' }).status, 'missing');
});
