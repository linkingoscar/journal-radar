'use strict';
const $ = (s) => document.querySelector(s);
const KEY = 'journal-radar:reading:v1';
let data = null,
  group = 'hr35',
  view = 'all',
  limit = 40,
  installPrompt = null;
const articleData = new JournalData.Library();
let historyTail = Promise.resolve(),
  historyBusy = false,
  historyError = '';
function historyScope() {
  return new Set(
    data.journals
      .filter((j) =>
        journalId || $('#journal').value ? j.id === (journalId || $('#journal').value) : inGroup(j),
      )
      .map((j) => j.id),
  );
}
function needsHistory() {
  if (browseMode === 'saved') {
    const known = new Set(allKnown().map((a) => a.id));
    return Object.keys(state.saved).some((id) => !known.has(id) && !data?.reading_aliases?.[id]);
  }
  return (
    browseMode !== 'library' &&
    ($('#search').value.trim() ||
      $('#period').value === 'all' ||
      $('#sort').value === 'published' ||
      $('#journal').value ||
      journalId)
  );
}
function ensureHistory(force = false) {
  if (!data || (!force && !needsHistory())) return historyTail;
  const ids = historyScope();
  historyTail = historyTail
    .catch(() => {})
    .then(async () => {
      if (!articleData.pending(ids).length) return;
      historyBusy = true;
      historyError = '';
      render();
      try {
        const rows = await articleData.history(ids);
        if (rows && data) {
          data.articles = rows;
          applyReadingAliases();
          await hydrateReading();
        }
      } catch (error) {
        historyError = error.message;
      } finally {
        historyBusy = false;
        render();
      }
    });
  return historyTail;
}
let browseMode = 'library',
  journalId = null;
let archiveReadingAliases = {};
let state = { read: {}, saved: {}, custom: [], folders: [] };
const readingStore = JournalReading.store();
let remembered = [],
  readingWrites = Promise.resolve(),
  hydration = null;
function allKnown() {
  return JournalReading.merge(data?.articles || [], remembered, {
    ...archiveReadingAliases,
    ...data?.reading_aliases,
  });
}
function rememberArticle(a) {
  if (!a) return;
  try {
    const row = JournalReading.article(a);
    remembered = JournalReading.merge([row], remembered);
    readingWrites = readingWrites
      .then(() => readingStore.put([row]))
      .catch((error) => toast(error.message));
  } catch (error) {
    toast(error.message);
  }
}
function hydrateReading() {
  if (hydration) return hydration;
  if (!data) return Promise.resolve();
  hydration = (async () => {
    try {
      const ids = Object.keys({ ...state.read, ...state.saved });
      if (isDesktop)
        for (let i = 0; i < ids.length; i += 100) {
          const r = await fetch('api/reading-articles?ids=' + ids.slice(i, i + 100).join(','), {
            cache: 'no-store',
          });
          if (!r.ok) throw new Error('旧阅读记录的文章信息暂未恢复，请稍后刷新。');
          const result = await r.json();
          Object.assign(archiveReadingAliases, result.reading_aliases || {});
          applyReadingAliases();
          for (const a of result.articles) rememberArticle(a);
        }
      for (const a of allKnown()) if (state.read[a.id] || state.saved[a.id]) rememberArticle(a);
      await readingWrites;
    } catch (error) {
      toast(error.message);
    } finally {
      hydration = null;
      render();
    }
  })();
  return hydration;
}
const isDesktop =
  location.origin === 'http://127.0.0.1:8766' ||
  (/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin) &&
    document.querySelector('meta[name="radar-desktop"]')?.content === location.origin);
const libraryUI = new JournalLibrary.Manager({
  desktop: isDesktop,
  data: () => data,
  group: () => group,
  reload: () => load(),
  toast,
});
libraryUI.bind();
let desktopSession = null,
  desktopRevision = null,
  migrationWindow = null,
  translationController = null,
  abstractController = null;
let pendingArticleId = /^#article=([a-f0-9]{64})$/.exec(location.hash)?.[1];
const EMAIL_KEY = 'journal-radar:translation-email';
function translationEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) || '';
  } catch {
    return '';
  }
}
const translator = new JournalTranslation.Engine({ getEmail: translationEmail });
let autoTranslate = true;
try {
  autoTranslate = localStorage.getItem('journal-radar:auto-translate') !== 'false';
} catch {}
try {
  const old = JSON.parse(localStorage.getItem(KEY));
  if (old) state = validateState(old);
} catch {
  /* Recover with an empty state. */
}
function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效备份');
  const map = (name) => {
    const result = {};
    if (input[name] && typeof input[name] === 'object' && !Array.isArray(input[name])) {
      for (const [id, value] of Object.entries(input[name]))
        if (/^[a-f0-9]{64}$/.test(id) && value === true) result[id] = true;
    }
    return result;
  };
  const saved = map('saved');
  return {
    read: map('read'),
    saved,
    folders: JournalReading.folders(input.folders || [], saved),
    custom: Array.isArray(input.custom)
      ? [...new Set(input.custom.filter((s) => /^(\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})$/.test(s)))]
      : [],
  };
}
const favorites = new JournalFavorites({
  state: () => state,
  persist,
  render,
  known: () => allKnown(),
  remember: rememberArticle,
  journals: () => data?.journals || [],
  toast,
});
const stateSync = new JournalState.Sync({
  initial: state,
  normalize: validateState,
  onChange(next) {
    if (JSON.stringify(state) === JSON.stringify(next)) return;
    state = next;
    if (data) {
      updateJournals();
      render();
    }
  },
  notify(next) {
    // Keep a compatibility copy and notify other tabs; IndexedDB is authoritative.
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  },
});
function persist() {
  const saving = stateSync.save(state);
  saving.catch((error) => toast(error.message));
  return saving;
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, action, cls) {
  const b = el('button', text, cls);
  b.type = 'button';
  b.addEventListener('click', action);
  return b;
}
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($('#toast').hidden = true), 4500);
}
function label(g) {
  return libraryUI.label(g);
}
function inGroup(j) {
  return (
    group === 'all' || (group === 'custom' ? state.custom.includes(j.id) : j.groups.includes(group))
  );
}
function readableDate(s) {
  return s ? s.slice(0, 10).replaceAll('-', '.') : '日期未提供';
}
function safeLink(s) {
  try {
    const u = new URL(s);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '#';
  } catch {
    return '#';
  }
}
function updateJournals() {
  libraryUI.sidebar(state.custom);
  const select = $('#journal');
  select.replaceChildren(new Option('所有期刊', ''));
  for (const j of data.journals.filter(inGroup).sort((a, b) => a.name.localeCompare(b.name)))
    select.add(new Option(j.name, j.id));
  $('#custom-count').textContent = state.custom.length;
  $('#all-count').textContent = data.journals.length;
}
function applyRoute(focus = false) {
  if (!data) return;
  const legacy = /^#(library|feed)=core10$/.exec(location.hash);
  if (legacy) history.replaceState(null, '', '#' + legacy[1] + '=hr35');
  const wasSaved = browseMode === 'saved';
  const journalRoute = /^#journal=(\d{4}-\d{3}[\dX]|rss-[a-f0-9]{16})$/.exec(location.hash);
  const sectionRoute = /^#(library|feed)=([a-z][a-z0-9_-]{0,63})$/.exec(location.hash);
  journalId = journalRoute?.[1] || null;
  const journal = data.journals.find((j) => j.id === journalId);
  if (location.hash === '#saved') {
    browseMode = 'saved';
    group = 'all';
    view = 'saved';
    $('#search').value = '';
    $('#period').value = 'all';
    $('#abstract-filter').value = 'all';
  } else if (journal) {
    browseMode = 'journal';
    if (!inGroup(journal)) group = 'all';
    $('#search').value = '';
    $('#period').value = 'all';
    $('#abstract-filter').value = 'all';
    view = 'all';
  } else {
    if (wasSaved) view = 'all';
    journalId = null;
    browseMode = sectionRoute?.[1] || 'library';
    if (sectionRoute) group = libraryUI.has(sectionRoute[2]) ? sectionRoute[2] : 'all';
  }
  archives.enter(journal || null);
  if (!libraryUI.has(group)) group = 'all';
  limit = 40;
  updateJournals();
  $('#journal').value = journalId || '';
  render();
  ensureHistory();
  if (focus) $('#group-title').focus({ preventScroll: false });
}
function renderCatalog(journals) {
  const q = $('#catalog-search').value.trim().toLowerCase();
  const visible = journals
    .filter((j) =>
      [j.name, j.short_name, ...j.issns, JOURNAL_CATALOG[j.id]?.discipline].some((s) =>
        (s || '').toLowerCase().includes(q),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const counts = new Map();
  for (const a of data.articles) {
    const c = counts.get(a.journal_id) || { total: 0, unread: 0 };
    c.total++;
    if (!state.read[a.id]) c.unread++;
    counts.set(a.journal_id, c);
  }
  $('#catalog-count').textContent =
    `共 ${visible.length} 本期刊${q ? ' · 当前分组 ' + journals.length + ' 本' : ''}`;
  const list = $('#catalog-cards');
  list.replaceChildren();
  for (const j of visible) {
    const meta = JOURNAL_CATALOG[j.id] || {},
      count = counts.get(j.id) || { total: 0, unread: 0 };
    const card = el('a', undefined, 'catalog-card');
    card.href = '#journal=' + j.id;
    card.setAttribute('aria-label', '查看 ' + j.name + ' 的文章');
    const cover = el('div', undefined, 'catalog-cover');
    cover.setAttribute('aria-hidden', 'true');
    cover.append(el('span', j.short_name || j.name, 'cover-fallback'));
    if (meta.cover) {
      const img = el('img');
      img.src = meta.cover;
      img.alt = '';
      img.loading = 'lazy';
      img.width = 120;
      img.height = 168;
      img.addEventListener('error', () => img.remove());
      cover.append(img);
    }
    const body = el('div', undefined, 'catalog-body');
    body.append(
      el('h2', j.name),
      el('p', meta.discipline || j.publisher || '学术期刊', 'catalog-discipline'),
      el('p', j.issns.length ? 'ISSN ' + j.issns.join(' / ') : 'RSS 订阅', 'catalog-issn'),
    );
    const tags = el('div', undefined, 'catalog-tags');
    j.groups.forEach((g) => tags.append(el('span', label(g), 'catalog-tag catalog-tag-' + g)));
    for (const r of meta.ratings || [])
      tags.append(
        el(
          'span',
          `${r.catalog === 'FMS(Global)' ? 'FMS' : r.catalog} ${r.level} · ${r.year}`,
          'catalog-tag catalog-tag-rating',
        ),
      );
    const stats = el('div', undefined, 'catalog-stats');
    stats.append(
      el('span', `${j.article_count || count.total} 篇已收录 · 已加载 ${count.total} 篇`),
      el('span', '阅读 →'),
    );
    body.append(tags, stats);
    card.append(cover, body);
    list.append(card);
  }
  if (!visible.length) {
    const empty = el('div', undefined, 'empty');
    empty.append(
      el('strong', q ? '没有找到匹配的期刊' : '还没有自选期刊'),
      el(
        'p',
        q
          ? '试试刊名、简称或 ISSN，也可以切换到「全部期刊」。'
          : '在「管理期刊与数据源」中勾选你关注的期刊。',
      ),
    );
    list.append(empty);
  }
}
function toggle(kind, id) {
  const enabled = !state[kind][id];
  const aliases = Object.entries({ ...archiveReadingAliases, ...data?.reading_aliases })
    .filter(([, target]) => target === id)
    .map(([alias]) => alias);
  for (const key of aliases) delete state[kind][key];
  if (enabled) state[kind][id] = true;
  else delete state[kind][id];
  if (kind === 'saved' && !enabled)
    state.folders = JournalReading.folders(state.folders, state.saved);
  if (enabled)
    rememberArticle(
      allKnown().find((a) => a.id === id) || archives.result?.articles.find((a) => a.id === id),
    );
  persist();
  render();
}
function applyReadingAliases() {
  const aliases = { ...archiveReadingAliases, ...data?.reading_aliases };
  for (const [oldId, id] of Object.entries(aliases)) {
    for (const field of ['read', 'saved'])
      if (state[field][oldId]) {
        state[field][id] = true;
        if (oldId !== id) delete state[field][oldId];
      }
  }
  state.folders = JournalReading.remapFolders(state.folders, aliases, state.saved);
  return persist();
}
function abstractText(article, journal) {
  const info = JournalFeed.abstractInfo(article);
  return info.status === 'available' ? info.text : '';
}
function addTranslation(article, journal, content) {
  const text = abstractText(article, journal);
  if (!/[a-zA-Z]{3}/.test(text)) return;
  if (!text) return;
  const block = el('section', undefined, 'translation-block'),
    heading = el('div', undefined, 'translation-heading'),
    output = el('p', '点击按钮获取中文摘要。', 'translation-text'),
    note = el('p', 'MyMemory 免费翻译 · 译文缓存在本机 · 英文原文保留在下方', 'translation-note');
  output.setAttribute('role', 'status');
  const translate = async () => {
    translationController?.abort();
    const controller = new AbortController();
    translationController = controller;
    action.disabled = true;
    output.classList.remove('translation-error');
    try {
      const result = await translator.translate(text, {
        signal: controller.signal,
        onProgress: (i, n) => {
          if (block.isConnected) output.textContent = `正在翻译 ${Math.min(i + 1, n)}/${n} 段…`;
        },
      });
      if (!block.isConnected || controller.signal.aborted) return;
      output.textContent = result.text;
      note.textContent =
        (result.cached ? '已读取缓存' : '已保存译文') + ' · MyMemory 机器翻译，仅供阅读参考';
      action.textContent = '查看缓存译文';
    } catch (error) {
      if (!controller.signal.aborted && block.isConnected) {
        output.textContent = error.message;
        output.classList.add('translation-error');
        action.textContent = '重试翻译';
      }
    } finally {
      action.disabled = false;
    }
  };
  const action = button('翻译摘要', translate);
  heading.append(el('h3', '中文摘要'), action);
  block.append(heading, output, note);
  content.append(block);
  if (autoTranslate) translate();
}
function renderAbstract(article, journal, content) {
  content.replaceChildren();
  const text = abstractText(article, journal);
  if (text) {
    addTranslation(article, journal, content);
    content.append(
      el('div', '英文摘要', 'reader-original-label'),
      el('p', text, 'reader-abstract'),
    );
    if (article.abstract_source) {
      const source = el('a', '摘要来源：' + article.abstract_source, 'translation-settings-link');
      source.href = safeLink(article.abstract_url || article.link);
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      content.append(source);
    }
    return;
  }
  const info = JournalFeed.abstractInfo(article);
  const status = el(
    'p',
    info.status === 'suspect'
      ? '摘要疑似不完整，暂不自动翻译；可补取或粘贴原文核对。'
      : '当前采集来源尚未提供摘要。',
    'reader-abstract',
  );
  status.setAttribute('role', 'status');
  content.append(status);
  if (info.status === 'suspect') {
    const excerpt = el('details');
    excerpt.append(el('summary', '查看来源提供的摘要片段'), el('p', info.text, 'reader-abstract'));
    content.append(excerpt);
  }
  const manual = el('details'),
    manualTitle = el('summary', '粘贴原文摘要'),
    manualText = el('textarea');
  manualText.rows = 7;
  manualText.maxLength = 20000;
  manualText.setAttribute('aria-label', '原文摘要');
  const saveManual = button('保存原文摘要', () => {
    try {
      const saved = JournalReading.manual(article, manualText.value);
      abstractController?.abort();
      Object.assign(article, saved);
      rememberArticle(article);
      renderAbstract(article, journal, content);
      render();
      toast('已保存原文摘录，导出完整备份时会一并备份。');
    } catch (error) {
      toast(error.message);
    }
  });
  manual.append(
    manualTitle,
    el(
      'p',
      '从出版商原文复制摘要。保存后会明确标为手动摘录，不会伪装成自动核验结果。',
      'translation-note',
    ),
    manualText,
    saveManual,
  );
  content.append(manual);
  if (!isDesktop) {
    content.append(
      el(
        'p',
        '云端会定时尝试补全。也可先双击 Windows 桌面「期刊雷达」启动本机组件，再打开下方链接按篇补取。',
        'translation-note',
      ),
    );
    const local = el('a', '在桌面版补取这篇摘要 ↗', 'translation-settings-link');
    local.href = 'http://127.0.0.1:8766/#article=' + article.id;
    local.target = '_blank';
    local.rel = 'noopener noreferrer';
    content.append(local);
    return;
  }
  const retrieve = async () => {
    abstractController?.abort();
    const controller = new AbortController();
    abstractController = controller;
    action.disabled = true;
    status.textContent = '正在查找已有摘要，可能需要等待片刻…';
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
      const session = await fetch('api/session', { signal, cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('本机组件未连接，请重新打开桌面应用。');
        return r.json();
      });
      const response = await fetch('api/abstract/' + article.id, {
        method: 'POST',
        headers: { 'X-Radar-Token': session.token },
        signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '摘要补取失败，请稍后重试。');
      if (controller.signal.aborted || !content.isConnected) return;
      if (result.abstract) {
        const fields = {
          abstract: result.abstract,
          abstract_source: result.source,
          abstract_url: result.source_url,
        };
        Object.assign(article, fields);
        const current = data.articles.find((a) => a.id === article.id);
        if (current) Object.assign(current, fields);
        rememberArticle(article);
        renderAbstract(article, journal, content);
        render();
      } else {
        status.textContent = result.message || '来源暂未提供可核对的摘要，请打开原文查看。';
        action.textContent = '重试补取摘要';
      }
    } catch (error) {
      if (!controller.signal.aborted && content.isConnected) {
        status.textContent =
          error.name === 'TimeoutError' ? '补取等待超时，请稍后重试。' : error.message;
        action.textContent = '重试补取摘要';
      }
    } finally {
      action.disabled = false;
    }
  };
  const action = button('补取摘要', retrieve, 'abstract-retrieve');
  content.append(action);
  retrieve();
}
function openArticle(article) {
  article = JournalReading.merge([article], remembered).find((a) => a.id === article.id);
  translationController?.abort();
  abstractController?.abort();
  const journal = data.journals.find((j) => j.id === article.journal_id);
  const content = $('#reader-content');
  content.replaceChildren();
  content.append(
    el('div', journal.name, 'eyebrow'),
    el('h2', article.title, 'reader-title'),
    el('p', article.authors || '作者信息暂缺', 'reader-meta'),
  );
  content.append(
    el(
      'p',
      '发表：' +
        readableDate(article.published_date) +
        (article.online_date ? ' · 在线发表：' + readableDate(article.online_date) : '') +
        (article.print_date ? ' · 正式刊期：' + readableDate(article.print_date) : ''),
      'reader-meta',
    ),
  );
  const abstract = el('div');
  content.append(abstract);
  renderAbstract(article, journal, abstract);
  if (article.doi || article.resolved_doi)
    content.append(el('p', 'DOI ' + (article.doi || article.resolved_doi), 'reader-doi'));
  const actions = el('div', undefined, 'reader-buttons');
  const link = el('a', '打开原文 ↗', 'primary');
  link.href = safeLink(article.link);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  actions.append(
    link,
    button(state.saved[article.id] ? '★ 已收藏' : '☆ 收藏', (e) => {
      toggle('saved', article.id);
      e.currentTarget.textContent = state.saved[article.id] ? '★ 已收藏' : '☆ 收藏';
    }),
  );
  actions.append(
    button('APA 引用', () => favorites.cite([article])),
    button('收藏分组', () => favorites.assign([article.id], article)),
  );
  content.append(actions);
  state.read[article.id] = true;
  rememberArticle(article);
  persist();
  render();
  $('#reader').showModal();
}
function render() {
  if (!data) return;
  const journals = data.journals.filter(inGroup),
    ids = new Set(journals.map((j) => j.id));
  const current = data.journals.find((j) => j.id === journalId),
    isLibrary = browseMode === 'library';
  document.body.classList.toggle('reading-view', !isLibrary);
  const pending = articleData.pending(historyScope()).reduce((n, c) => n + c.count, 0);
  $('#history-loading').hidden =
    isLibrary ||
    (browseMode === 'saved' && !needsHistory() && !historyBusy && !historyError) ||
    (!pending && !historyError);
  $('#history-message').textContent = historyBusy
    ? '正在读取更早文章…'
    : historyError
      ? historyError + '；当前文章仍可阅读。'
      : `还有 ${pending} 篇更早收录的文章，可按需查看。`;
  $('#load-history').disabled = historyBusy;
  archives.sync();
  $('#journal-library').hidden = !isLibrary;
  $('#article-feed').hidden = isLibrary || (!!current && archives.mode === 'archive');
  $('#back-library').hidden = !current;
  $('#back-library').href = '#library=' + group;
  $('#library-mode').href = '#library=' + group;
  $('#feed-mode').href = '#feed=' + group;
  for (const [id, active] of [
    ['library-mode', ['library', 'journal'].includes(browseMode)],
    ['feed-mode', browseMode === 'feed'],
    ['saved-mode', browseMode === 'saved'],
  ]) {
    if (active) $('#' + id).setAttribute('aria-current', 'page');
    else $('#' + id).removeAttribute('aria-current');
  }
  $('#groups')
    .querySelectorAll('button')
    .forEach((b) => {
      b.classList.toggle('active', b.dataset.group === group);
      b.setAttribute('aria-pressed', String(b.dataset.group === group));
    });
  $('#views')
    .querySelectorAll('button')
    .forEach((b) => {
      b.classList.toggle('selected', b.dataset.view === view);
      b.setAttribute('aria-pressed', String(b.dataset.view === view));
    });
  $('#journal').hidden = !!current;
  const recentIds = new Set(data.articles.map((a) => a.id));
  const all = allKnown().filter(
    (a) =>
      ids.has(a.journal_id) &&
      (view === 'saved' || browseMode === 'saved' || recentIds.has(a.id)) &&
      (browseMode !== 'saved' || state.saved[a.id]),
  );
  $('#article-total').textContent = all.length.toLocaleString();
  const title = $('#group-title');
  title.replaceChildren(document.createTextNode(label(group)), el('span', '的新进展'));
  $('#group-description').textContent =
    group === 'hr35'
      ? '你指定的 35 本期刊，涵盖人力资源、组织行为与管理研究。'
      : group === 'ft50'
        ? 'FT50 · 2026 年 4 月版，50 本期刊的研究动态。'
        : group === 'utd24'
          ? 'UTD24 · 跨管理、金融、营销、会计与信息系统。'
          : group === 'custom'
            ? '在「管理期刊与数据源」中选择你想单独关注的期刊。'
            : group === 'all'
              ? '全部期刊汇聚于此，重叠清单合并展示。'
              : `${label(group)} · ${journals.length} 本期刊，可在「管理分组」中调整。`;
  $('#total-label').textContent = isLibrary ? '本关注期刊' : '篇已收录文章';
  if (isLibrary) {
    title.replaceChildren(document.createTextNode(label(group)), el('span', '的期刊库'));
    $('#article-total').textContent = journals.length;
    renderCatalog(journals);
  }
  if (current) {
    title.textContent = current.name;
    $('#group-description').textContent =
      (current.issns.length ? 'ISSN ' + current.issns.join(' / ') : 'RSS 订阅') +
      ' · ' +
      current.groups.map(label).join(' · ');
    $('#article-total').textContent = all
      .filter((a) => a.journal_id === current.id)
      .length.toLocaleString();
  }
  if (current) $('#total-label').textContent = '篇近期已收录';
  if (browseMode === 'saved') {
    title.textContent = '我的全部收藏';
    $('#group-description').textContent =
      '跨期刊、跨年份汇总近期与历史收藏；文章信息随阅读记录一起备份。';
    $('#article-total').textContent = all.filter((a) => state.saved[a.id]).length;
    $('#total-label').textContent = '篇收藏文章';
  }
  $('#views').hidden = browseMode === 'saved';
  const q = $('#search').value.trim().toLowerCase(),
    selected = current?.id || $('#journal').value;
  const days = $('#period').value;
  const cutoff =
    days === 'all' ? '' : new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10);
  const selection = JournalFeed.select(all, {
    journal: selected,
    cutoff,
    query: q,
    sort: $('#sort').value,
    view,
    state,
    matches: (a) => browseMode !== 'saved' || favorites.matches(a),
    abstract: $('#abstract-filter').value,
  });
  const articles = selection.articles;
  favorites.sync(browseMode === 'saved', articles);
  const knownIds = new Set(allKnown().map((a) => a.id)),
    knownAliases = { ...archiveReadingAliases, ...data?.reading_aliases };
  const unknown = Object.keys(state.saved).filter(
    (id) => !knownIds.has(id) && !knownAliases[id],
  ).length;
  $('#coverage-status').textContent =
    browseMode === 'saved' && unknown
      ? `${unknown} 条旧收藏暂缺文章信息。本机可从已查询目录恢复；其他设备请导入新版阅读备份。`
      : `当前筛选范围 ${selection.total} 篇 · ${selection.missing} 篇缺摘要 · ${selection.suspect} 篇疑似不完整`;
  $('#period').setAttribute(
    'aria-label',
    $('#sort').value === 'discovered' ? '收录时间范围' : '发表时间范围',
  );
  $('label[for="period"]').textContent = $('#period').getAttribute('aria-label');
  $('#period').title =
    $('#sort').value === 'discovered'
      ? '按首次收录时间筛选'
      : '按在线或发表时间筛选；仅有未来刊期时使用收录日期';
  $('#result-count').textContent =
    `${articles.length.toLocaleString()} 篇文章 · ${selected ? 1 : journals.length} 本期刊`;
  $('#updated').textContent =
    '数据生成于 ' +
    new Date(data.generated_at).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  const scopedJournals = selected ? journals.filter((j) => j.id === selected) : journals;
  const failures = scopedJournals.filter((j) => j.status === 'error' || j.status === 'partial');
  const pendingJournals = scopedJournals.filter((j) => j.status === 'pending');
  const stale =
    Date.now() - new Date(data.cloud_updated_at || data.generated_at).getTime() > 48 * 3600000;
  $('#notice').hidden = !failures.length && !pendingJournals.length && !stale;
  $('#notice').textContent = [
    failures.length
      ? `${failures.length} 本期刊存在来源请求失败，历史文章仍可阅读。详情见「管理期刊与数据源」。`
      : '',
    pendingJournals.length ? `${pendingJournals.length} 本期刊等待首次采集。` : '',
    stale ? '数据已超过 48 小时未更新，请检查云端采集任务。' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const list = $('#articles');
  list.replaceChildren();
  if (!articles.length) {
    const box = el('div', undefined, 'empty');
    box.append(
      el('strong', '这里暂时没有文章'),
      el(
        'p',
        view === 'saved'
          ? '点击文章旁的「收藏」，把值得细读的研究留在这里。'
          : '试试放宽时间范围、清除关键词，或切换期刊分组。',
      ),
    );
    list.append(box);
  }
  const byId = new Map(data.journals.map((j) => [j.id, j]));
  for (const article of articles.slice(0, limit)) {
    const j = byId.get(article.journal_id),
      card = el('article', undefined, 'article' + (state.read[article.id] ? ' is-read' : ''));
    const top = el('div', undefined, 'article-top');
    top.append(
      el('span', j.name, 'journal-name'),
      el('time', JournalFeed.dateLabel(article, new Date().toISOString().slice(0, 10)), 'date'),
    );
    const heading = el('h2');
    heading.append(button(article.title, () => openArticle(article)));
    card.append(
      top,
      heading,
      el('p', article.authors || '作者信息暂缺', 'authors'),
      el(
        'p',
        abstractText(article, j) ||
          (JournalFeed.abstractInfo(article).status === 'suspect'
            ? '摘要疑似不完整，打开文章查看原片段或补取。'
            : '当前来源未提供摘要，打开文章查看补取方式。'),
        'abstract-preview',
      ),
    );
    const bottom = el('div', undefined, 'article-bottom'),
      tags = el('div', undefined, 'tags'),
      actions = el('div', undefined, 'article-actions');
    j.groups.forEach((g) => tags.append(el('span', label(g), 'tag')));
    if (
      article.article_type &&
      article.article_type !== 'journal-article' &&
      article.article_type !== 'rss-entry'
    )
      tags.append(el('span', article.article_type, 'tag'));
    if (article.archive)
      tags.append(el('span', (article.archive_year || '往期') + ' 年历史文章', 'tag'));
    const read = button(state.read[article.id] ? '✓ 已读' : '标记已读', () =>
      toggle('read', article.id),
    );
    read.setAttribute(
      'aria-label',
      (state.read[article.id] ? '标为未读：' : '标为已读：') + article.title,
    );
    const saved = button(
      state.saved[article.id] ? '★ 已收藏' : '☆ 收藏',
      () => toggle('saved', article.id),
      state.saved[article.id] ? 'saved' : '',
    );
    saved.setAttribute('aria-pressed', String(!!state.saved[article.id]));
    saved.setAttribute(
      'aria-label',
      (state.saved[article.id] ? '取消收藏：' : '收藏：') + article.title,
    );
    const link = el('a', '原文 ↗');
    link.href = safeLink(article.link);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (browseMode === 'saved') actions.append(favorites.checkbox(article));
    actions.append(
      read,
      saved,
      button('APA 引用', () => favorites.cite([article])),
      button('收藏分组', () => favorites.assign([article.id], article)),
      link,
    );
    bottom.append(tags, actions);
    card.append(bottom);
    list.append(card);
  }
  $('#more').hidden = articles.length <= limit;
}
const archives = new JournalArchives({
  root: $('#journal-archive'),
  desktop: isDesktop,
  reading: () => state,
  open: openArticle,
  toggle,
  onMode: render,
  cite: (a) => favorites.cite([a]),
  assign: (a) => favorites.assign([a.id], a),
  aliases: (aliases) => {
    Object.assign(archiveReadingAliases, aliases);
    applyReadingAliases();
  },
  request: async (identifier, query, signal) => {
    if (!desktopSession) {
      const response = await fetch('api/session', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('本机组件未连接');
      desktopSession = await response.json();
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      signal.throwIfAborted();
      const response = await fetch('api/archive/' + identifier + query, {
        method: 'POST',
        headers: { 'X-Radar-Token': desktopSession.token },
        signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '目录加载失败');
      return result;
    }
    throw new Error('目录查询繁忙，请稍后重试。');
  },
});
async function load() {
  $('#refresh').disabled = true;
  try {
    const next = await articleData.refresh();
    for (const journal of next.journals)
      journal.groups = journal.groups.filter((g) => g !== 'core10');
    const firstLoad = !data,
      previous = $('#journal').value;
    libraryUI.apply(next);
    data = next;
    if (!libraryUI.has(group)) {
      group = 'all';
      history.replaceState(null, '', '#library=all');
      browseMode = 'library';
      journalId = null;
      archives.enter(null);
    }
    applyReadingAliases();
    updateJournals();
    if ([...$('#journal').options].some((o) => o.value === previous))
      $('#journal').value = previous;
    if (firstLoad) applyRoute();
    else render();
    if (firstLoad && location.hash === '#add-journal') libraryUI.openAdd();
    if (firstLoad) hydrateReading();
    $('#connection').textContent = navigator.onLine ? '阅读数据已载入' : '离线阅读';
    if (pendingArticleId) {
      let article = allKnown().find((a) => a.id === pendingArticleId);
      if (!article) {
        const rows = await articleData.history(new Set(data.journals.map((j) => j.id)));
        if (rows) data.articles = rows;
        article = allKnown().find((a) => a.id === pendingArticleId);
      }
      pendingArticleId = null;
      if (article) openArticle(article);
      else toast('尚未收录这篇文章，请更新列表或导入阅读备份。');
    }
    ensureHistory();
  } catch (error) {
    $('#connection').textContent = '暂时无法更新';
    $('#notice').hidden = false;
    $('#notice').textContent = '读取失败，请检查网络后重试。' + (data ? ' 已保留当前文章。' : '');
  } finally {
    $('#refresh').disabled = false;
  }
}
function settings() {
  const list = $('#journal-settings');
  list.replaceChildren();
  for (const j of data.journals) {
    const row = el('div', undefined, 'journal-setting'),
      labelNode = el('label'),
      check = el('input');
    check.type = 'checkbox';
    check.checked = state.custom.includes(j.id);
    check.addEventListener('change', () => {
      state.custom = check.checked
        ? [...state.custom, j.id]
        : state.custom.filter((id) => id !== j.id);
      persist();
      updateJournals();
      render();
    });
    labelNode.append(check, document.createTextNode(j.name));
    row.append(
      labelNode,
      el('small', j.groups.map(label).join(' · ') + ' · ISSN ' + j.issns.join(' / ')),
    );
    if (j.coverage_note) row.append(el('small', j.coverage_note));
    const articles = data.articles.filter((a) => a.journal_id === j.id),
      missing = articles.filter((a) => !abstractText(a)).length;
    row.append(
      el(
        'small',
        `近期收录 ${articles.length} 篇 · ${missing} 篇缺摘要 · ${articles.length ? Math.round(((articles.length - missing) / articles.length) * 100) : 0}% 有摘要`,
      ),
    );
    for (const h of j.health) {
      row.append(
        el(
          'small',
          h.source.toUpperCase() +
            ' · ' +
            (!h.last_attempt
              ? '等待首次采集'
              : h.error
                ? '本次失败：' + h.error
                : `请求完成，返回 ${h.item_count} 条`) +
            (h.last_success
              ? ' · 上次成功 ' + new Date(h.last_success).toLocaleString('zh-CN')
              : ''),
          h.error ? 'health-error' : 'health-ok',
        ),
      );
    }
    list.append(row);
  }
  $('#settings').showModal();
}
$('#groups').addEventListener('click', (event) => {
  const b = event.target.closest('[data-group]');
  if (!b || !data) return;
  location.hash = (browseMode === 'feed' ? 'feed' : 'library') + '=' + b.dataset.group;
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#main') applyRoute(true);
});
$('#catalog-search').addEventListener('input', () => {
  if (data) renderCatalog(data.journals.filter(inGroup));
});
document.querySelector('.catalog-layout').addEventListener('click', (event) => {
  const b = event.target.closest('[data-layout]');
  if (!b) return;
  $('#catalog-cards').classList.toggle('catalog-list', b.dataset.layout === 'list');
  document
    .querySelectorAll('[data-layout]')
    .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
$('#views').addEventListener('click', (event) => {
  const b = event.target.closest('[data-view]');
  if (!b) return;
  view = b.dataset.view;
  limit = 40;
  $('#views')
    .querySelectorAll('button')
    .forEach((x) => {
      x.classList.toggle('selected', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
  render();
});
let searchTimer;
['search', 'journal', 'period', 'sort', 'abstract-filter'].forEach((id) =>
  $('#' + id).addEventListener(id === 'search' ? 'input' : 'change', () => {
    limit = 40;
    render();
    clearTimeout(searchTimer);
    if (id === 'search') searchTimer = setTimeout(() => ensureHistory(), 350);
    else ensureHistory();
  }),
);
$('#load-history').addEventListener('click', () => ensureHistory(true));
$('#more').addEventListener('click', () => {
  limit += 40;
  render();
});
$('#refresh').addEventListener('click', load);
$('#reader').addEventListener('close', () => {
  translationController?.abort();
  abstractController?.abort();
});
$('#auto-translate').checked = autoTranslate;
$('#auto-translate').addEventListener('change', (event) => {
  autoTranslate = event.target.checked;
  try {
    localStorage.setItem('journal-radar:auto-translate', String(autoTranslate));
  } catch {
    toast('翻译设置未能保存。');
  }
});
function showTranslationSettings() {
  $('#translation-email').value = translationEmail();
  $('#translation-email-status').textContent = translationEmail()
    ? '已启用邮箱版：约 50,000 字符/天。'
    : '尚未配置邮箱：匿名版约 5,000 字符/天。';
}
$('#translation-settings').addEventListener('click', () => {
  showTranslationSettings();
  $('#translation-options').showModal();
});
function saveTranslationEmail(value) {
  try {
    const email = JournalTranslation.normalizeEmail(value);
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
    translationController?.abort();
    showTranslationSettings();
    $('#translation-email-status').textContent = email
      ? '已保存，后续翻译使用邮箱版（约 50,000 字符/天）。'
      : '邮箱已移除，后续翻译使用匿名版（约 5,000 字符/天）。';
  } catch (error) {
    $('#translation-email-status').textContent =
      error.name === 'QuotaExceededError' || error.name === 'SecurityError'
        ? '邮箱未能保存，请检查浏览器存储设置。'
        : error.message;
  }
}
$('#translation-email-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveTranslationEmail($('#translation-email').value);
});
$('#clear-translation-email').addEventListener('click', () => saveTranslationEmail(''));
window.addEventListener('storage', (event) => {
  if (event.key === EMAIL_KEY || event.key === null) {
    translationController?.abort();
    if ($('#translation-options').open) showTranslationSettings();
  }
});
async function refreshReading() {
  try {
    await stateSync.flush();
    remembered = JournalReading.merge(await readingStore.all(), remembered);
    if (data) render();
  } catch (error) {
    toast(error.message);
  }
}
window.addEventListener('storage', (event) => {
  if (event.key === KEY || event.key === null) refreshReading();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshReading();
});
$('#manage').addEventListener('click', () => {
  if (data) settings();
});
document
  .querySelectorAll('.close')
  .forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
async function makeBackup() {
  if (!data) throw new Error('请等待期刊数据载入后再备份');
  await stateSync.flush().catch(() => {});
  await readingWrites;
  await hydrateReading();
  const known = new Set(allKnown().map((a) => a.id));
  if (!isDesktop && Object.keys({ ...state.read, ...state.saved }).some((id) => !known.has(id))) {
    try {
      const rows = await articleData.history(new Set(data.journals.map((j) => j.id)));
      if (rows) data.articles = rows;
      await hydrateReading();
    } catch {
      /* Preserve unresolved IDs in an offline recovery backup. */
    }
  }
  await stateSync.flush().catch(() => {});
  return JournalBackup.create({
    state,
    articles: allKnown(),
    library: libraryUI.backup(),
    autoTranslate,
    translator,
  });
}
async function restoreBackup(input) {
  if (!data) throw new Error('请等待期刊数据载入后再导入');
  const backup = await JournalBackup.parse(input, validateState),
    restored = backup.state;
  if (
    !backup.library &&
    backup.articles.some((a) => !data.journals.some((j) => j.id === a.journal_id))
  )
    throw new Error('旧备份缺少期刊配置，请先添加所属期刊或从原设备导出完整备份');
  const aliases = backup.library ? await libraryUI.restore(backup.library) : {};
  const incoming = backup.articles.map((a) => ({
    ...a,
    journal_id: aliases[a.journal_id] || a.journal_id,
  }));
  await readingWrites;
  const merged = JournalReading.merge(remembered, incoming);
  await readingStore.put(merged);
  remembered = merged;
  const saved = { ...state.saved, ...restored.saved };
  state = {
    read: { ...state.read, ...restored.read },
    saved,
    folders: JournalReading.mergeFolders(state.folders, restored.folders, saved),
    custom: [...new Set([...state.custom, ...restored.custom.map((id) => aliases[id] || id)])],
  };
  await applyReadingAliases();
  updateJournals();
  render();
  for (const item of backup.translations) await translator.restore(item.source, item.text);
  if (backup.settings) {
    autoTranslate = backup.settings.auto_translate;
    $('#auto-translate').checked = autoTranslate;
    localStorage.setItem('journal-radar:auto-translate', String(autoTranslate));
  }
  await hydrateReading();
}
$('#backup').addEventListener('click', async () => {
  $('#backup').disabled = true;
  try {
    const backup = await makeBackup(),
      blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      a = el('a');
    a.href = url;
    a.download = 'journal-radar-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已备份阅读记录、${backup.articles.length} 篇文章、缓存译文和个人期刊配置。`);
  } catch (error) {
    toast('导出未完成：' + error.message);
  } finally {
    $('#backup').disabled = false;
  }
});
$('#restore').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 50e6) throw new Error('备份超过 50 MB');
    await restoreBackup(JSON.parse(await file.text()));
    toast('已合并阅读记录、文章、译文和备份中的期刊配置。');
  } catch (error) {
    toast('导入未全部完成，可修正后重新导入：' + error.message);
  }
  event.target.value = '';
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
$('#install').addEventListener('click', async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = null;
  } else $('#help').showModal();
});
document.addEventListener('keydown', (event) => {
  if (
    event.key === '/' &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
    !document.querySelector('dialog[open]')
  ) {
    event.preventDefault();
    $(browseMode === 'library' ? '#catalog-search' : '#search').focus();
  }
});
if ('serviceWorker' in navigator) {
  const loadedWithWorker = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (loadedWithWorker) $('#update-banner').hidden = false;
  });
  navigator.serviceWorker
    .register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
$('#apply-update').addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.set('version', Date.now());
  location.replace(url.href);
});
async function pollDesktop() {
  try {
    const response = await fetch('api/session', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const next = await response.json();
    if (next.app !== 'journal-radar-desktop') throw new Error();
    desktopSession = next;
    $('#sync-local').disabled = next.running;
    $('#sync-local').textContent = next.paused ? '继续补采' : '本机补采';
    $('#pause-abstracts').hidden = !next.running || !next.abstract_stage;
    $('#desktop-status').textContent =
      next.phase +
      (next.running && next.total ? `（${next.completed}/${next.total}）` : '') +
      (next.error ? ' · ' + next.error : '');
    if (next.data_revision !== desktopRevision) {
      desktopRevision = next.data_revision;
      await load();
    }
  } catch {
    $('#desktop-status').textContent = '本机组件未连接，请重新双击桌面图标启动。';
    $('#sync-local').disabled = true;
  }
}
$('#sync-local').addEventListener('click', async () => {
  if (!desktopSession) return;
  $('#sync-local').disabled = true;
  try {
    const response = await fetch('api/sync', {
      method: 'POST',
      headers: { 'X-Radar-Token': desktopSession.token },
    });
    if (!response.ok) throw new Error();
    await pollDesktop();
  } catch {
    toast('无法启动补采，请重新打开桌面应用。');
    $('#sync-local').disabled = false;
  }
});
$('#pause-abstracts').addEventListener('click', async () => {
  if (!desktopSession) return;
  try {
    const response = await fetch('api/abstracts/pause', {
      method: 'POST',
      headers: { 'X-Radar-Token': desktopSession.token },
    });
    if (!response.ok) throw new Error();
    await pollDesktop();
  } catch {
    toast('暂停失败，请稍后重试。');
  }
});
$('#migrate-reading').addEventListener('click', () => {
  migrationWindow = window.open(
    'https://linkingoscar.github.io/journal-radar/#transfer-to-local',
    'journal-radar-reading-migration',
    'width=620,height=460',
  );
  if (!migrationWindow) toast('请允许打开迁移窗口，或使用导出/导入备份。');
});
window.addEventListener('message', async (event) => {
  if (
    !isDesktop ||
    event.origin !== 'https://linkingoscar.github.io' ||
    event.source !== migrationWindow ||
    event.data?.type !== 'journal-radar-reading'
  )
    return;
  try {
    await restoreBackup(event.data.backup || { version: 1, ...event.data.state });
    toast('已合并网页版阅读内容和个人配置。');
    migrationWindow.close();
    migrationWindow = null;
  } catch (error) {
    toast('迁移未全部完成，请导出完整备份后重试：' + error.message);
  }
});
async function boot() {
  $('#edition-label').textContent = isDesktop ? '期刊雷达 · 本机增强版' : '期刊雷达 · 网页阅读版';
  $('#install').hidden = isDesktop;
  try {
    await stateSync.flush();
  } catch (error) {
    toast(error.message);
  }
  try {
    remembered = (await readingStore.all()).map(JournalReading.article);
  } catch (error) {
    toast(error.message);
  }
  await load();
  if (
    location.origin === 'https://linkingoscar.github.io' &&
    location.pathname === '/journal-radar/' &&
    location.hash === '#transfer-to-local' &&
    window.opener
  ) {
    try {
      const backup = await makeBackup();
      window.opener.postMessage(
        { type: 'journal-radar-reading', state, backup },
        'http://127.0.0.1:8766',
      );
    } catch (error) {
      toast('迁移备份未完成：' + error.message);
    }
  }
  if (isDesktop) {
    $('#desktop-bar').hidden = false;
    pollDesktop();
    setInterval(pollDesktop, 5000);
  }
}
boot();
