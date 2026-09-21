'use strict';
const JournalData = (() => {
  class Library {
    constructor(fetcher = (...args) => fetch(...args)) {
      this.fetcher = fetcher;
      this.cache = new Map();
      this.loaded = new Set();
      this.version = 0;
    }
    async json(url, options) {
      const response = await this.fetcher(url, options);
      if (!response.ok) throw new Error('文章数据暂时无法读取（' + response.status + '）');
      return response.json();
    }
    async refresh() {
      const next = await this.json('index.json?t=' + Date.now(), { cache: 'no-store' });
      if (!Array.isArray(next.articles) || !Array.isArray(next.journals))
        throw new Error('文章数据格式错误');
      this.index = next;
      this.version++;
      const keep = new Set((next.history_chunks || []).map((c) => c.url));
      for (const url of this.cache.keys()) if (!keep.has(url)) this.cache.delete(url);
      this.loaded = new Set();
      const rows = new Map(next.articles.map((a) => [a.id, a]));
      for (const chunk of next.history_chunks || []) {
        if (this.cache.has(chunk.url)) {
          for (const a of this.cache.get(chunk.url)) rows.set(a.id, a);
          this.loaded.add(chunk.url);
        }
      }
      this.rows = rows;
      return { ...next, articles: [...rows.values()] };
    }
    pending(ids) {
      return (this.index?.history_chunks || []).filter(
        (c) => ids.has(c.journal_id) && !this.loaded.has(c.url),
      );
    }
    async history(ids, progress = () => {}) {
      const version = this.version,
        chunks = this.pending(ids);
      // Publish only a complete requested scope; failures retain the existing list.
      const incoming = [];
      for (const [i, chunk] of chunks.entries()) {
        if (!/^articles\/[a-f0-9]{64}\.json$/.test(chunk.url)) throw new Error('历史数据地址无效');
        let rows = this.cache.get(chunk.url);
        if (!rows) {
          const value = await this.json(chunk.url);
          rows = value.articles;
          if (
            !Array.isArray(rows) ||
            rows.length !== chunk.count ||
            rows.some((a) => a.journal_id !== chunk.journal_id || !/^[a-f0-9]{64}$/.test(a.id))
          )
            throw new Error('历史数据与期刊不匹配');
          this.cache.set(chunk.url, rows);
        }
        incoming.push([chunk.url, rows]);
        progress(i + 1, chunks.length);
      }
      if (version !== this.version) return null;
      for (const [url, rows] of incoming) {
        for (const a of rows) this.rows.set(a.id, a);
        this.loaded.add(url);
      }
      return [...this.rows.values()];
    }
  }
  return { Library };
})();
if (typeof module !== 'undefined') module.exports = JournalData;
