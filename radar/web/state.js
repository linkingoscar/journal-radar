'use strict';
// Reading changes are merged inside one IndexedDB transaction across all tabs.
const JournalState = (() => {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const difference = (before, after) => {
    const old = new Set(before),
      next = new Set(after);
    return {
      add: after.filter((id) => !old.has(id)),
      remove: before.filter((id) => !next.has(id)),
    };
  };
  const applySet = (values, patch) => {
    const removed = new Set(patch.remove);
    return [...new Set([...values.filter((id) => !removed.has(id)), ...patch.add])];
  };

  function changes(before, after) {
    const patch = {};
    for (const key of ['read', 'saved']) {
      patch[key] = difference(Object.keys(before[key]), Object.keys(after[key]));
    }
    patch.custom = difference(before.custom, after.custom);
    patch.checked = Object.fromEntries(
      Object.entries(after.checked || {}).filter(
        ([scope, date]) => date !== before.checked?.[scope],
      ),
    );
    const old = new Map(before.folders.map((folder) => [folder.id, folder]));
    patch.deleted = before.folders
      .filter((f) => !after.folders.some((n) => n.id === f.id))
      .map((f) => f.id);
    patch.folders = after.folders.flatMap((folder) => {
      const previous = old.get(folder.id);
      const members = difference(previous?.articles || [], folder.articles);
      if (
        previous &&
        previous.name === folder.name &&
        !members.add.length &&
        !members.remove.length
      )
        return [];
      return [
        {
          id: folder.id,
          create: !previous,
          name: previous?.name === folder.name ? null : folder.name,
          members,
        },
      ];
    });
    return patch;
  }

  function apply(state, patch) {
    state = copy(state);
    for (const key of ['read', 'saved']) {
      state[key] = Object.fromEntries(
        applySet(Object.keys(state[key]), patch[key]).map((id) => [id, true]),
      );
    }
    state.custom = applySet(state.custom, patch.custom);
    for (const [scope, date] of Object.entries(patch.checked || {})) {
      state.checked ||= {};
      if (!state.checked[scope] || Date.parse(date) > Date.parse(state.checked[scope]))
        state.checked[scope] = date;
    }
    state.folders = state.folders.filter((f) => !patch.deleted.includes(f.id));
    for (const change of patch.folders) {
      let folder = state.folders.find((f) => f.id === change.id);
      // A stale membership edit must not resurrect a deleted folder.
      if (!folder && !change.create) continue;
      if (!folder)
        state.folders.push((folder = { id: change.id, name: change.name, articles: [] }));
      if (change.name !== null) folder.name = change.name;
      folder.articles = applySet(folder.articles, change.members);
    }
    for (const folder of state.folders)
      folder.articles = folder.articles.filter((id) => state.saved[id]);
    return state;
  }

  function database() {
    let connection;
    const open = () =>
      (connection ||= new Promise((resolve, reject) => {
        const request = indexedDB.open('journal-radar-reading-state', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            connection = null;
          };
          resolve(request.result);
        };
        request.onerror = () => {
          connection = null;
          reject(new Error('无法打开阅读记录，请检查浏览器存储权限。'));
        };
      }));
    return async (update) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('state', 'readwrite'),
          store = tx.objectStore('state');
        let result, failure;
        const request = store.get('reading');
        request.onsuccess = () => {
          try {
            result = update(request.result);
            store.put(result, 'reading');
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () =>
          reject(failure || new Error('阅读记录未能保存，请导出备份后重试。'));
      });
    };
  }

  class Sync {
    constructor({
      initial,
      normalize,
      commit = database(),
      onChange = () => {},
      notify = () => {},
    }) {
      Object.assign(this, { normalize, commit, onChange, notify });
      this.current = copy(initial);
      this.seed = copy(initial);
      this.pending = [];
      this.tail = Promise.resolve();
    }
    save(next) {
      const clean = this.normalize(next);
      if (JSON.stringify(clean) !== JSON.stringify(this.current)) {
        this.pending.push(changes(this.current, clean));
        this.current = copy(clean);
      }
      return this.flush();
    }
    flush() {
      const run = async () => {
        const batch = this.pending.slice();
        const saved = await this.commit((latest) =>
          this.normalize(batch.reduce(apply, this.normalize(latest || this.seed))),
        );
        this.pending.splice(0, batch.length);
        this.current = this.pending.reduce(apply, saved);
        this.onChange(copy(this.current));
        if (batch.length) this.notify(saved);
        return saved;
      };
      this.tail = this.tail.catch(() => {}).then(run);
      return this.tail;
    }
  }
  return { Sync, changes, apply };
})();
if (typeof module !== 'undefined') module.exports = JournalState;
