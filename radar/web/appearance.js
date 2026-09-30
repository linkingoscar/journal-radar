'use strict';
const JournalAppearance = (() => {
  const KEY = 'journal-radar:effects:v1';
  function read(storage) {
    try {
      return storage.getItem(KEY) === 'reduced';
    } catch {
      return false;
    }
  }
  function apply(root, reduced) {
    root.dataset.effects = reduced ? 'reduced' : 'auto';
  }
  function bind({ root, control, storage, events, notify }) {
    const sync = () => {
      control.checked = read(storage);
      apply(root, control.checked);
    };
    sync();
    control.addEventListener('change', () => {
      // Apply immediately even when private browsing or storage limits prevent saving.
      apply(root, control.checked);
      try {
        storage.setItem(KEY, control.checked ? 'reduced' : 'auto');
      } catch {
        notify('界面效果已调整，但此设备无法保存设置，刷新后会恢复默认。');
      }
    });
    events.addEventListener('storage', (event) => {
      if (event.key === KEY || event.key === null) sync();
    });
  }
  return { KEY, read, apply, bind };
})();
// Read before the styles load to avoid flashing glass or motion on a reduced-effects device.
if (typeof document !== 'undefined')
  JournalAppearance.apply(
    document.documentElement,
    JournalAppearance.read({ getItem: (key) => localStorage.getItem(key) }),
  );
if (typeof module !== 'undefined') module.exports = JournalAppearance;
