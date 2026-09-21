const test = require('node:test'),
  assert = require('node:assert/strict');
const P = require('./web/personal.js');
test('reading preferences survive reload without replacing independent backup metadata', () => {
  const values = new Map(),
    storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v) };
  const first = new P.Store(storage),
    second = new P.Store(storage);
  first.update({
    preferences: P.preferences({
      route: '#feed=custom',
      view: 'new',
      period: 'all',
      scroll: 1234,
      limit: 80,
    }),
  });
  second.update({ backup: { exportedAt: '2026-09-21T00:00:00Z' } });
  assert.equal(new P.Store(storage).read().preferences.scroll, 1234);
  assert.equal(first.read().backup.exportedAt, '2026-09-21T00:00:00Z');
  const invalid = P.preferences({
    route: 'https://example.com/',
    view: 'invalid',
    scroll: -1,
    limit: Infinity,
  });
  assert.equal(invalid.route, '#feed=hr35');
  assert.equal(invalid.scroll, 0);
  assert.equal(invalid.limit, 40);
});
test('backup reminders respect new bookmarks, elapsed time and unchanged records', () => {
  const state = { read: {}, saved: {}, folders: [], custom: [] },
    now = Date.parse('2026-09-21T00:00:00Z');
  const meta = { startedAt: '2026-09-01T00:00:00Z' };
  assert.equal(P.reminder(state, meta, now).due, false);
  state.saved.one = true;
  assert.equal(P.reminder(state, meta, now).due, true);
  const backup = {
    exportedAt: new Date(now).toISOString(),
    saved: ['one'],
    state: JSON.stringify(state),
  };
  assert.equal(P.reminder(state, backup, now + 30 * 86400000).due, false);
  for (let i = 0; i < 10; i++) state.saved['new' + i] = true;
  assert.equal(P.reminder(state, backup, now).added, 10);
  assert.equal(P.reminder(state, backup, now).due, true);
});
test('bulk read and undo touch only newly read displayed records and preserve other activity', () => {
  const state = { read: { existing: true }, saved: { unseen: true } };
  const changed = P.markRead(state, ['existing', 'visible', 'visible']);
  assert.deepEqual(changed, ['visible']);
  assert.equal(state.read.unseen, undefined);
  state.read.anotherWindow = true;
  P.undoRead(state, changed);
  assert.deepEqual(state.read, { existing: true, anotherWindow: true });
  assert.deepEqual(state.saved, { unseen: true });
});
