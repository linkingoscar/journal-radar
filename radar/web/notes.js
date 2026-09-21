'use strict';
const JournalNotes = (() => {
  function records(value = {}) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length > 20000
    )
      throw new Error('文章笔记数量无效');
    const result = {};
    for (const [id, row] of Object.entries(value)) {
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        !row ||
        typeof row.note !== 'string' ||
        row.note.length > 20000 ||
        !Array.isArray(row.tags) ||
        row.tags.length > 20 ||
        row.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40) ||
        typeof row.updated_at !== 'string' ||
        !Number.isFinite(Date.parse(row.updated_at))
      )
        throw new Error('笔记或标签格式无效（笔记最多 20,000 字，20 个标签，每个 40 字）');
      result[id] = {
        note: row.note.trim(),
        tags: [...new Set(row.tags.map((t) => t.trim()))],
        updated_at: new Date(row.updated_at).toISOString(),
      };
    }
    return result;
  }
  function merge(current, incoming, aliases = {}) {
    const result = structuredClone(records(current));
    for (const [oldId, row] of Object.entries(records(incoming))) {
      const id = aliases[oldId] || oldId,
        old = result[id];
      if (!old) result[id] = row;
      else {
        // Keep both texts on import; repeated imports do not append the same text.
        const note =
          !row.note || old.note.includes(row.note)
            ? old.note
            : !old.note
              ? row.note
              : old.note + '\n\n—— 导入的笔记 ——\n' + row.note;
        result[id] = {
          note,
          tags: [...new Set([...old.tags, ...row.tags])],
          updated_at: old.updated_at > row.updated_at ? old.updated_at : row.updated_at,
        };
      }
    }
    return records(result);
  }
  class Manager {
    constructor(options) {
      this.options = options;
      this.$ = (s) => document.querySelector(s);
    }
    draft() {
      return {
        note: this.$('#article-note').value.trim(),
        tags: [
          ...new Set(
            this.$('#article-note-tags')
              .value.split(/[,，]/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
      };
    }
    dirty() {
      if (!this.$('#note-editor').open) return false;
      return (
        JSON.stringify(this.draft()) !==
        JSON.stringify({ note: this.original?.note || '', tags: this.original?.tags || [] })
      );
    }
    open(article) {
      this.article = article;
      this.original = structuredClone(this.options.state().annotations?.[article.id] || null);
      this.$('#note-article-title').textContent = article.title;
      this.$('#article-note').value = this.original?.note || '';
      this.$('#article-note-tags').value = (this.original?.tags || []).join(', ');
      this.$('#note-message').textContent = '';
      this.$('#discard-note').hidden = true;
      this.$('#note-editor').showModal();
    }
    sync() {
      const list = this.$('#personal-tags');
      list.replaceChildren();
      for (const tag of [
        ...new Set(Object.values(this.options.state().annotations || {}).flatMap((r) => r.tags)),
      ].sort()) {
        const option = document.createElement('option');
        option.value = tag;
        list.append(option);
      }
    }
    requestClose(event) {
      if (!this.dirty()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.$('#discard-note').hidden = false;
    }
    bind() {
      this.$('#note-editor').addEventListener('cancel', (e) => this.requestClose(e));
      this.$('#note-editor').addEventListener(
        'click',
        (e) => {
          if (e.target.closest('.close')) this.requestClose(e);
        },
        true,
      );
      this.$('#discard-note-confirm').addEventListener('click', () => {
        this.$('#note-editor').close();
      });
      this.$('#keep-note-editing').addEventListener('click', () => {
        this.$('#discard-note').hidden = true;
        this.$('#article-note').focus();
      });
      window.addEventListener('beforeunload', (e) => {
        if (this.dirty()) {
          e.preventDefault();
          e.returnValue = '';
        }
      });
      this.$('#note-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        this.$('#note-controls').disabled = true;
        try {
          const draft = this.draft(),
            row = records({
              [this.article.id]: { ...draft, updated_at: new Date().toISOString() },
            })[this.article.id];
          const value = row.note || row.tags.length ? row : null;
          await this.options.save(this.article, this.original, value);
          this.original = value;
          this.$('#note-editor').close();
          this.options.toast(
            value ? '笔记与标签已保存，文章已加入收藏。' : '笔记与标签已清除，文章收藏保留。',
          );
        } catch (error) {
          this.$('#note-message').textContent = error.message;
        } finally {
          this.$('#note-controls').disabled = false;
        }
      });
    }
  }
  return { records, merge, Manager };
})();
if (typeof module !== 'undefined') module.exports = JournalNotes;
