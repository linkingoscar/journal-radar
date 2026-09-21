'use strict';
const JournalFilters = (() => {
  const Personal = typeof module !== 'undefined' ? require('./personal.js') : JournalPersonal;
  function records(value = {}) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length > 50
    )
      throw new Error('常用筛选最多保存 50 个');
    const result = {};
    for (const [id, row] of Object.entries(value)) {
      if (
        !/^filter-[a-f0-9-]{36}$/.test(id) ||
        !row ||
        typeof row.name !== 'string' ||
        !row.name.trim() ||
        row.name.length > 60 ||
        !/^#(?:feed=[a-z][a-z0-9_-]{0,63}|saved)$/.test(row.preferences?.route || '')
      )
        throw new Error('常用筛选格式无效');
      result[id] = {
        name: row.name.trim(),
        preferences: Personal.preferences({ ...row.preferences, scroll: 0, limit: 40 }),
      };
    }
    return result;
  }
  class Manager {
    constructor(options) {
      this.options = options;
      this.$ = (s) => document.querySelector(s);
    }
    sync() {
      const select = this.$('#saved-query'),
        previous = select.value;
      select.replaceChildren(new Option('选择常用筛选', ''));
      for (const [id, row] of Object.entries(this.options.state().queries || {}))
        select.add(new Option(row.name, id));
      if ([...select.options].some((o) => o.value === previous)) select.value = previous;
      this.$('#apply-query').disabled = this.$('#edit-query').disabled = !select.value;
    }
    edit(id = '') {
      this.id = id || 'filter-' + crypto.randomUUID();
      this.original = id ? structuredClone(this.options.state().queries[id]) : null;
      this.$('#query-name').value = this.original?.name || '';
      this.$('#query-replace').checked = false;
      this.$('#query-replace-label').hidden = !id;
      this.$('#delete-query').hidden = !id;
      this.$('#query-message').textContent = '';
      this.$('#query-editor').showModal();
    }
    bind() {
      this.$('#saved-query').addEventListener('change', () => this.sync());
      this.$('#save-query').addEventListener('click', () => this.edit());
      this.$('#edit-query').addEventListener('click', () =>
        this.edit(this.$('#saved-query').value),
      );
      this.$('#apply-query').addEventListener('click', () => {
        const row = this.options.state().queries[this.$('#saved-query').value];
        if (row) this.options.apply(row.preferences);
      });
      this.$('#query-form').addEventListener('submit', (event) => {
        event.preventDefault();
        this.save(false);
      });
      this.$('#delete-query').addEventListener('click', () => this.save(true));
    }
    async save(remove) {
      this.$('#query-controls').disabled = true;
      try {
        const row = remove
          ? null
          : records({
              [this.id]: {
                name: this.$('#query-name').value,
                preferences:
                  !this.original || this.$('#query-replace').checked
                    ? this.options.capture()
                    : this.original.preferences,
              },
            })[this.id];
        await this.options.save(this.id, this.original, row);
        this.sync();
        this.$('#saved-query').value = remove ? '' : this.id;
        this.sync();
        this.$('#query-editor').close();
        this.options.toast(remove ? '常用筛选已删除。' : '常用筛选已保存，可一键打开。');
      } catch (error) {
        this.$('#query-message').textContent = error.message;
      } finally {
        this.$('#query-controls').disabled = false;
      }
    }
  }
  return { records, Manager };
})();
if (typeof module !== 'undefined') module.exports = JournalFilters;
