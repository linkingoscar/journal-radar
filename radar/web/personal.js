'use strict';
const JournalPersonal = (() => {
  const KEY = 'journal-radar:personal:v1';
  const route = (value) =>
    typeof value === 'string' &&
    /^#(?:(?:library|feed)=[a-z][a-z0-9_-]{0,63}|journal=(?:\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})|saved)$/.test(
      value,
    );
  function preferences(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    const choose = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    return {
      route: route(input.route) ? input.route : '#feed=hr35',
      view: choose(input.view, ['all', 'unread', 'saved', 'new'], 'all'),
      period: choose(input.period, ['30', '90', 'all'], '90'),
      sort: choose(input.sort, ['discovered', 'published'], 'discovered'),
      abstract: choose(input.abstract, ['all', 'missing', 'suspect'], 'all'),
      journal: typeof input.journal === 'string' ? input.journal.slice(0, 80) : '',
      search: typeof input.search === 'string' ? input.search.slice(0, 2000) : '',
      catalogSearch:
        typeof input.catalogSearch === 'string' ? input.catalogSearch.slice(0, 200) : '',
      layout: choose(input.layout, ['grid', 'list'], 'grid'),
      limit: Number.isInteger(input.limit) ? Math.max(40, Math.min(20000, input.limit)) : 40,
      scroll: Number.isFinite(input.scroll) ? Math.max(0, Math.min(2000000, input.scroll)) : 0,
    };
  }
  function checked(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    return Object.fromEntries(
      Object.entries(input)
        .filter(
          ([key, value]) =>
            /^(?:group:[a-z][a-z0-9_-]{0,63}|journal:(?:\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16}))$/.test(
              key,
            ) &&
            typeof value === 'string' &&
            Number.isFinite(Date.parse(value)),
        )
        .map(([key, value]) => [key, new Date(value).toISOString()]),
    );
  }
  function reminder(state, meta, now = Date.now()) {
    const saved = Object.keys(state.saved),
      previous = new Set(Array.isArray(meta.saved) ? meta.saved : []);
    const added = saved.filter((id) => !previous.has(id)).length;
    const last = Date.parse(meta.exportedAt || meta.startedAt);
    const changed = JSON.stringify(state) !== meta.state;
    const hasRecords =
      saved.length || Object.keys(state.read).length || state.folders.length || state.custom.length;
    return {
      added,
      due:
        !!hasRecords &&
        changed &&
        (added >= 10 || (Number.isFinite(last) && now - last >= 14 * 86400000)),
    };
  }
  class Store {
    constructor(storage, onError = () => {}) {
      this.storage = storage;
      this.onError = onError;
      this.fallback = {};
    }
    read() {
      try {
        const value = JSON.parse(this.storage.getItem(KEY));
        if (value && typeof value === 'object' && !Array.isArray(value)) this.fallback = value;
      } catch {
        /* Preferences are optional; reading records have their own durable store. */
      }
      return this.fallback;
    }
    update(patch) {
      this.fallback = { ...this.read(), ...patch };
      try {
        this.storage.setItem(KEY, JSON.stringify(this.fallback));
      } catch {
        if (!this.warned) this.onError('浏览偏好暂时无法保存；请检查浏览器存储权限。');
        this.warned = true;
      }
    }
  }
  function markRead(state, ids) {
    const changed = [...new Set(ids)].filter((id) => !state.read[id]);
    for (const id of changed) state.read[id] = true;
    return changed;
  }
  function undoRead(state, ids) {
    for (const id of ids) delete state.read[id];
  }
  return { Store, preferences, checked, reminder, markRead, undoRead };
})();
if (typeof module !== 'undefined') module.exports = JournalPersonal;
