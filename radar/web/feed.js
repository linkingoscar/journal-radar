'use strict';
const JournalFeed = (() => {
  function abstractInfo(article) {
    let text = (article.abstract || '').trim();
    if (/^Publication date[:：]/i.test(text))
      text = text.match(/\bAbstract\s*[:：]?\s+([\s\S]+)/i)?.[1] || '';
    if (/^.{0,150},\s*Volume\b/i.test(text) || /not available|no abstract available/i.test(text))
      text = '';
    const suspect = !!text && (/^[=,;)\]}]/.test(text) || /^(?:\.{3}|…)|(?:\.{3}|…)$/.test(text));
    return { text, status: !text ? 'missing' : suspect ? 'suspect' : 'available' };
  }
  function future(date, today) {
    return !!date && date > today.slice(0, date.length);
  }
  function publicationDate(article, today) {
    const date = article.online_date || article.published_date;
    return date && !future(date, today) ? date : (article.first_seen || '').slice(0, 10);
  }
  function dateLabel(article, today) {
    const value = (date) => date.replaceAll('-', '.');
    if (future(article.print_date || article.published_date, today)) {
      return '预排刊期 ' + value(article.print_date || article.published_date);
    }
    return article.published_date ? value(article.published_date) : '日期未提供';
  }
  function select(
    rows,
    {
      journal = '',
      cutoff = '',
      today = new Date().toISOString().slice(0, 10),
      sort = 'discovered',
      query = '',
      view = 'all',
      since = '',
      state,
      matches = () => true,
      abstract = 'all',
    },
  ) {
    const base = rows.filter((a) => {
      const date =
        sort === 'discovered' ? (a.first_seen || '').slice(0, 10) : publicationDate(a, today);
      return (
        (!journal || a.journal_id === journal) &&
        (view !== 'new' || !since || Date.parse(a.first_seen) > Date.parse(since)) &&
        matches(a) &&
        (!cutoff || date >= cutoff.slice(0, date.length)) &&
        (!query ||
          [a.title, a.authors, a.abstract, a.doi].some((s) =>
            (s || '').toLowerCase().includes(query),
          )) &&
        (view !== 'unread' || !state.read[a.id]) &&
        (view !== 'saved' || state.saved[a.id])
      );
    });
    const missing = base.filter((a) => abstractInfo(a).status === 'missing').length;
    const suspect = base.filter((a) => abstractInfo(a).status === 'suspect').length;
    const articles = base.filter(
      (a) =>
        abstract === 'all' ||
        (abstract === 'missing'
          ? abstractInfo(a).status !== 'available'
          : abstractInfo(a).status === 'suspect'),
    );
    const date = (a) => (sort === 'discovered' ? a.first_seen || '' : publicationDate(a, today));
    articles.sort((a, b) => date(b).localeCompare(date(a)) || a.id.localeCompare(b.id));
    return { articles, total: base.length, missing, suspect };
  }
  function counts(journals, rows, selected = '') {
    const scope = journals.filter((j) => !selected || j.id === selected),
      ids = new Set(scope.map((j) => j.id));
    return {
      total: scope.reduce((sum, j) => sum + (j.article_count || 0), 0),
      loaded: rows.filter((a) => ids.has(a.journal_id)).length,
    };
  }
  return { abstractInfo, future, publicationDate, dateLabel, select, counts };
})();
if (typeof module !== 'undefined') module.exports = JournalFeed;
