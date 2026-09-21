'use strict';
const JournalBackup = (() => {
  const Reading = typeof module !== 'undefined' ? require('./reading.js') : JournalReading;
  const Library = typeof module !== 'undefined' ? require('./library.js') : JournalLibrary;
  const Personal = typeof module !== 'undefined' ? require('./personal.js') : JournalPersonal;
  const Covers = typeof module !== 'undefined' ? require('./covers.js') : JournalCovers;
  function remapPreferences(value, aliases = {}) {
    const clean = Personal.preferences(value),
      journal = /^#journal=(.+)$/.exec(clean.route);
    return {
      ...clean,
      journal: aliases[clean.journal] || clean.journal,
      route: journal ? '#journal=' + (aliases[journal[1]] || journal[1]) : clean.route,
    };
  }
  async function parse(input, validateState) {
    const reading = Reading.backup(input),
      state = validateState(input);
    const library = input.version >= 4 ? await Library.validateBackup(input.library) : null;
    const settings = input.version >= 4 ? input.settings : null;
    const covers = input.version >= 5 ? Covers.records(input.covers) : [];
    if (
      input.version >= 4 &&
      (!settings || typeof settings !== 'object' || typeof settings.auto_translate !== 'boolean')
    )
      throw new Error('备份阅读设置无效');
    if (
      library &&
      reading.articles.some((a) => !library.journals.some((j) => j.id === a.journal_id))
    )
      throw new Error('备份文章缺少对应期刊配置');
    if (covers.some((r) => !library?.journals.some((j) => j.id === r.journal_id)))
      throw new Error('备份封面缺少对应期刊配置');
    return {
      ...reading,
      state,
      library,
      covers,
      settings: settings
        ? {
            auto_translate: settings.auto_translate,
            ...(settings.preferences
              ? { preferences: Personal.preferences(settings.preferences) }
              : {}),
          }
        : null,
    };
  }
  async function create({
    state,
    articles,
    library,
    autoTranslate,
    translator,
    preferences,
    covers = [],
  }) {
    const rows = articles
        .filter(
          (a) =>
            state.read[a.id] ||
            state.saved[a.id] ||
            state.annotations?.[a.id] ||
            a.citation?.manual,
        )
        .map(Reading.article),
      translations = [];
    for (const source of new Set(rows.map((a) => a.abstract).filter(Boolean))) {
      const cached = await translator.cached(source);
      if (cached?.text) translations.push({ source, text: cached.text });
    }
    const result = {
      version: 5,
      exported_at: new Date().toISOString(),
      ...state,
      articles: rows,
      translations,
      covers: Covers.records(covers),
      library: await Library.validateBackup(library),
      settings: {
        auto_translate: autoTranslate,
        ...(preferences ? { preferences: Personal.preferences(preferences) } : {}),
      },
    };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 50e6)
      throw new Error('备份超过 50 MB');
    return result;
  }
  return { parse, create, remapPreferences };
})();
if (typeof module !== 'undefined') module.exports = JournalBackup;
