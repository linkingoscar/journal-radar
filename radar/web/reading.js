'use strict';
const JournalReading = (() => {
  const fields = [
    'id',
    'journal_id',
    'title',
    'authors',
    'doi',
    'link',
    'abstract',
    'abstract_source',
    'abstract_url',
    'published_date',
    'print_date',
    'online_date',
    'first_seen',
    'source_first_seen',
    'volume',
    'issue',
    'pages',
    'article_number',
    'article_type',
    'sources',
    'resolved_doi',
  ];
  function article(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      !/^[a-f0-9]{64}$/.test(value.id) ||
      !/^(\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})$/.test(value.journal_id) ||
      typeof value.title !== 'string' ||
      !value.title.trim()
    )
      throw new Error('备份文章信息无效');
    const result = {};
    for (const field of fields) {
      const v = value[field];
      if (v !== undefined) {
        if (typeof v !== 'string' || v.length > (field === 'abstract' ? 20000 : 4000))
          throw new Error('备份文章字段无效');
        result[field] = v;
      }
    }
    if (value.citation !== undefined) result.citation = citation(value.citation);
    result.archive = value.archive === true;
    if (
      Number.isInteger(value.archive_year) &&
      value.archive_year >= 1500 &&
      value.archive_year <= 9999
    )
      result.archive_year = value.archive_year;
    if (value.year_basis === 'print' || value.year_basis === 'publication')
      result.year_basis = value.year_basis;
    return result;
  }
  function citation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('引用信息无效');
    const result = {};
    for (const key of [
      'title',
      'journal',
      'year',
      'volume',
      'issue',
      'pages',
      'article_number',
      'doi',
      'status',
      'checked_at',
    ]) {
      const v = value[key] ?? '';
      if (typeof v !== 'string' || v.length > 4000) throw new Error('引用字段无效');
      result[key] = v;
    }
    if (result.year && !/^[12]\d{3}$/.test(result.year)) throw new Error('引用年份无效');
    if (!['', 'advance online publication'].includes(result.status))
      throw new Error('引用发表状态无效');
    if (value.manual === true) result.manual = true;
    if (value.authors_incomplete === true) result.authors_incomplete = true;
    if (!Array.isArray(value.authors) || value.authors.length > 2000)
      throw new Error('引用作者无效');
    result.authors = value.authors.map((a) => {
      if (!a || typeof a !== 'object') throw new Error('引用作者无效');
      const name = {};
      for (const k of ['family', 'given', 'literal'])
        if (a[k] !== undefined) {
          if (typeof a[k] !== 'string' || a[k].length > 500) throw new Error('引用作者无效');
          name[k] = a[k];
        }
      if (!name.family?.trim() && !name.literal?.trim()) throw new Error('引用作者缺少姓或机构名');
      return name;
    });
    return result;
  }
  function folders(value = [], saved) {
    if (!Array.isArray(value) || value.length > 200) throw new Error('收藏分组无效');
    const seen = new Set();
    return value.map((f) => {
      if (
        !f ||
        !/^folder-[a-z0-9-]{1,80}$/.test(f.id) ||
        seen.has(f.id) ||
        typeof f.name !== 'string' ||
        !f.name.trim() ||
        f.name.length > 100 ||
        !Array.isArray(f.articles) ||
        f.articles.length > 20000 ||
        f.articles.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
      )
        throw new Error('收藏分组格式无效');
      seen.add(f.id);
      return {
        id: f.id,
        name: f.name.trim(),
        articles: [...new Set(f.articles)].filter((id) => !saved || saved[id]),
      };
    });
  }
  function mergeFolders(current, incoming, saved) {
    const result = new Map(folders(current).map((f) => [f.id, f]));
    for (const f of folders(incoming)) {
      const old = result.get(f.id);
      result.set(
        f.id,
        old ? { ...old, articles: [...new Set([...old.articles, ...f.articles])] } : f,
      );
    }
    return folders([...result.values()], saved);
  }
  function remapFolders(value, aliases, saved) {
    return folders(value).map((f) => ({
      ...f,
      articles: [...new Set(f.articles.map((id) => aliases[id] || id))].filter((id) => saved[id]),
    }));
  }
  function merge(recent, remembered, aliases = {}) {
    const rows = new Map();
    for (const a of [...remembered, ...recent]) {
      const id = aliases[a.id] || a.id,
        old = rows.get(id);
      if (a.id !== id && old) continue;
      // A new feed record must not erase a previously saved abstract.
      const next = { ...old, ...a, id };
      if (!a.abstract && old?.abstract)
        for (const k of ['abstract', 'abstract_source', 'abstract_url']) next[k] = old[k];
      if (
        old?.citation &&
        (!a.citation ||
          (old.citation.manual && !a.citation.manual) ||
          (old.citation.checked_at || '') > (a.citation.checked_at || ''))
      )
        next.citation = old.citation;
      rows.set(id, next);
    }
    return [...rows.values()];
  }
  function store() {
    let database;
    const open = () =>
      (database ??= new Promise((resolve, reject) => {
        const r = indexedDB.open('journal-radar-reading-articles', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('articles', { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(new Error('无法打开文章备份缓存'));
      }));
    return {
      async all() {
        const db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('articles'),
            r = tx.objectStore('articles').getAll();
          tx.oncomplete = () => resolve(r.result);
          tx.onerror = () => reject(new Error('无法读取文章备份缓存'));
        });
      },
      async put(rows) {
        const clean = rows.map(article),
          db = await open();
        return new Promise((resolve, reject) => {
          const tx = db.transaction('articles', 'readwrite');
          for (const row of clean) tx.objectStore('articles').put(row);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(new Error('文章信息未能保存，请导出完整备份'));
          tx.onabort = () => reject(new Error('文章信息保存中断'));
        });
      },
    };
  }
  function backup(input) {
    if (
      !input ||
      ![1, 2, 3, 4].includes(input.version) ||
      !input.read ||
      !input.saved ||
      !Array.isArray(input.custom)
    )
      throw new Error('备份格式不匹配');
    folders(input.folders || []);
    const articles = input.version >= 2 ? input.articles || [] : [];
    if (!Array.isArray(articles) || articles.length > 20000) throw new Error('备份文章数量无效');
    const rows = articles.map(article),
      translations = input.version >= 2 ? input.translations || [] : [];
    if (
      !Array.isArray(translations) ||
      translations.length > 20000 ||
      translations.some(
        (x) =>
          !x ||
          typeof x.source !== 'string' ||
          !x.source.trim() ||
          x.source.length > 20000 ||
          typeof x.text !== 'string' ||
          !x.text.trim() ||
          x.text.length > 100000,
      )
    )
      throw new Error('备份译文无效');
    return { articles: rows, translations };
  }
  function manual(value, text) {
    text = String(text).trim();
    if (text.length < 80 || text.length > 20000)
      throw new Error('请粘贴完整的原文摘要（80–20,000 个字符）。');
    return article({
      ...value,
      abstract: text,
      abstract_source: '手动摘录（未由来源接口核验）',
      abstract_url: value.link,
    });
  }
  return { article, citation, folders, mergeFolders, remapFolders, merge, store, backup, manual };
})();
if (typeof module !== 'undefined') module.exports = JournalReading;
