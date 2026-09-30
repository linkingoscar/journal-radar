const test = require('node:test'),
  assert = require('node:assert/strict');
const Appearance = require('./web/appearance.js');

function fixture(storage = new Map()) {
  const root = { dataset: {} },
    handlers = {},
    messages = [],
    control = {
      checked: false,
      addEventListener: (type, handler) => (handlers[type] = handler),
    };
  Appearance.bind({
    root,
    control,
    storage:
      storage instanceof Map
        ? {
            getItem: (key) => storage.get(key),
            setItem: (key, value) => storage.set(key, value),
          }
        : storage,
    events: { addEventListener: (type, handler) => (handlers[type] = handler) },
    notify: (message) => messages.push(message),
  });
  return { root, control, handlers, messages, storage };
}

test('effects preference survives reload and can return to system defaults', () => {
  const first = fixture();
  first.control.checked = true;
  first.handlers.change();
  const reloaded = fixture(first.storage);
  assert.equal(reloaded.control.checked, true);
  assert.equal(reloaded.root.dataset.effects, 'reduced');
  reloaded.control.checked = false;
  reloaded.handlers.change();
  assert.equal(fixture(first.storage).root.dataset.effects, 'auto');
});

test('storage failure still applies reduced effects and explains that it cannot persist', () => {
  const view = fixture({
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  });
  view.control.checked = true;
  view.handlers.change();
  assert.equal(view.root.dataset.effects, 'reduced');
  assert.equal(view.control.checked, true);
  assert.match(view.messages[0], /无法保存设置/);
});

test('another tab changes or clears effects while unrelated storage events do not reset them', () => {
  const view = fixture(new Map([[Appearance.KEY, 'reduced']]));
  view.storage.delete(Appearance.KEY);
  view.handlers.storage({ key: 'journal-radar:reading:v1' });
  assert.equal(view.root.dataset.effects, 'reduced');
  view.handlers.storage({ key: null });
  assert.equal(view.root.dataset.effects, 'auto');
  assert.equal(view.control.checked, false);
  view.storage.set(Appearance.KEY, 'reduced');
  view.handlers.storage({ key: Appearance.KEY });
  assert.equal(view.control.checked, true);
});
