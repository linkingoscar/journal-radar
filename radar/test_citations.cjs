const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const C = require('./web/citations.js'),
  R = require('./web/reading.js');
const assets = {
  processor: require('./web/citeproc.js'),
  style: fs.readFileSync(__dirname + '/web/apa.csl', 'utf8'),
  locale: fs.readFileSync(__dirname + '/web/locales-en-US.xml', 'utf8'),
};
const citation = {
  title: 'An example article',
  journal: 'Journal of Applied Psychology',
  authors: [
    { family: 'Smith', given: 'Alex' },
    { family: 'Chen', given: 'Mei' },
  ],
  year: '2026',
  volume: '12',
  issue: '3',
  pages: '121-130',
  article_number: '',
  doi: '10.1000/a',
  status: '',
};
const article = {
  id: 'a'.repeat(64),
  journal_id: '0021-9010',
  title: citation.title,
  doi: citation.doi,
  citation,
};
test('APA bibliography and in-text citations share sorted same-author/year suffixes, and DOI aliases deduplicate', () => {
  const result = C.format(
    [
      { id: 'b', citation: { ...citation, title: 'Zebra research', doi: '10.1000/b' } },
      { id: 'a', citation },
      { id: 'duplicate', citation: { ...citation, doi: 'https://doi.org/10.1000/A' } },
    ],
    assets,
  );
  assert.equal(result.rows.length, 2);
  assert.ok(result.text.indexOf('An example') < result.text.indexOf('Zebra'));
  assert.match(result.html, /<i>Journal of Applied Psychology<\/i>, <i>12<\/i>\(3\), 121–130/);
  assert.equal(result.entries.find((e) => e.id === 'a').parenthetical, '(Smith & Chen, 2026a)');
  assert.equal(result.entries.find((e) => e.id === 'a').narrative, 'Smith and Chen (2026a)');
  assert.match(result.text, /\(2026b\).*Zebra research/);
});
test('APA truncates 21 authors only in the bibliography and renders article numbers', () => {
  const authors = Array.from({ length: 21 }, (_, i) => ({
    family: 'Author' + String(i + 1).padStart(2, '0'),
    given: 'Jane',
  }));
  const result = C.format(
    [{ id: 'a', citation: { ...citation, authors, pages: '', article_number: 'e12345' } }],
    assets,
  );
  assert.match(result.text, /Author19, J\., … Author21, J\./);
  assert.doesNotMatch(result.text, /Author20/);
  assert.match(result.text, /Article e12345/);
  assert.equal(result.entries[0].parenthetical, '(Author01 et al., 2026)');
});
test('Crossref retains surnames and print year, rejects wrong identities; missing metadata never implies advance publication', () => {
  const journal = { name: citation.journal, issns: ['0021-9010'] },
    item = {
      DOI: article.doi,
      type: 'journal-article',
      ISSN: journal.issns,
      title: ['Study'],
      author: [{ family: 'de Vries', given: 'Anne Marie' }, { name: 'Research Consortium' }],
      'published-online': { 'date-parts': [[2025]] },
      'published-print': { 'date-parts': [[2026]] },
      volume: '12',
      page: '1-9',
    };
  const value = C.fromCrossref(item, article, journal);
  assert.equal(value.year, '2026');
  assert.equal(value.authors[0].family, 'de Vries');
  assert.equal(value.authors[1].literal, 'Research Consortium');
  assert.throws(() => C.fromCrossref({ ...item, DOI: '10.1000/wrong' }, article, journal));
  assert.throws(() => C.fromCrossref({ ...item, ISSN: ['0000-0000'] }, article, journal));
  const missing = { ...citation, volume: '', pages: '', authors: [] };
  assert.equal(C.warnings(missing).length, 3);
  assert.doesNotMatch(
    C.format([{ id: 'a', citation: missing }], assets).text,
    /Advance online publication/i,
  );
  assert.match(
    C.format([{ id: 'a', citation: { ...missing, status: 'advance online publication' } }], assets)
      .text,
    /Advance online publication/,
  );
});
test('folders preserve overlapping membership, merge backups and remap DOI identities without unsaving', () => {
  const b = 'b'.repeat(64),
    saved = { [article.id]: true, [b]: true },
    one = { id: 'folder-one', name: '论文', articles: [article.id] },
    two = { id: 'folder-two', name: '精读', articles: [article.id, b] };
  const merged = R.mergeFolders([one, two], [{ ...one, articles: [b] }], saved);
  assert.equal(merged[0].articles.length, 2);
  assert.equal(merged[1].articles.length, 2);
  const remapped = R.remapFolders(merged, { [article.id]: b }, { [b]: true });
  assert.deepEqual(remapped[0].articles, [b]);
  assert.deepEqual(R.folders([two], { [b]: true })[0].articles, [b]);
  assert.equal(saved[article.id], true);
  assert.throws(() => R.folders([{ ...one, articles: ['invalid'] }], saved));
  assert.throws(() => R.folders([one, one], saved));
});
test('v3 backups round-trip structured authors and manual edits survive refreshed source metadata', () => {
  const manual = {
    ...article,
    citation: {
      ...citation,
      title: 'Corrected title',
      manual: true,
      checked_at: '2026-09-14T10:00:00Z',
    },
  };
  const value = R.backup({
    version: 3,
    read: {},
    saved: { [article.id]: true },
    custom: [],
    folders: [{ id: 'folder-paper', name: '论文', articles: [article.id] }],
    articles: [manual],
  });
  const next = R.merge(
    [{ ...article, citation: { ...citation, checked_at: '2026-09-15T10:00:00Z' } }],
    value.articles,
  )[0];
  assert.equal(next.citation.title, 'Corrected title');
  assert.deepEqual(next.citation.authors, citation.authors);
  assert.throws(() =>
    R.article({ ...article, citation: { ...citation, authors: [{ family: { bad: true } }] } }),
  );
});
test('rate limits preserve metadata and manual citations do not make network requests', async () => {
  let saved = false,
    calls = 0;
  const engine = new C.Engine({
      remember: () => {
        saved = true;
      },
      fetcher: async () => {
        calls++;
        return { ok: false, status: 429 };
      },
    }),
    signal = new AbortController().signal;
  const failed = await engine.enrich(
    article,
    { name: citation.journal, issns: ['0021-9010'] },
    signal,
  );
  assert.match(failed.error, /限流/);
  assert.equal(failed.citation.title, citation.title);
  assert.equal(saved, false);
  await engine.enrich({ ...article, citation: { ...citation, manual: true } }, {}, signal);
  assert.equal(calls, 1);
});

test('citation processor loads on demand, shares concurrent loads and retries after failure', async () => {
  const vm = require('node:vm'),
    scripts = [],
    files = [];
  const context = vm.createContext({
    module: { exports: {} },
    document: {
      createElement: () => ({
        remove() {
          this.removed = true;
        },
      }),
      head: { append: (script) => scripts.push(script) },
    },
  });
  vm.runInContext(fs.readFileSync(__dirname + '/web/citations.js', 'utf8'), context);
  const engine = new context.module.exports.Engine({
    remember: () => {},
    fetcher: async (url) => {
      files.push(url);
      return { ok: true, text: async () => url };
    },
  });
  assert.equal(scripts.length, 0);
  const first = engine.assetsFor(),
    second = engine.assetsFor();
  assert.equal(scripts.length, 1);
  const failed = Promise.all([
    assert.rejects(first, /引用组件加载失败/),
    assert.rejects(second, /引用组件加载失败/),
  ]);
  scripts[0].onerror();
  await failed;
  assert.equal(scripts[0].removed, true);
  const retry = engine.assetsFor();
  assert.equal(scripts.length, 2);
  context.CSL = assets.processor;
  scripts[1].onload();
  assert.equal((await retry).processor, assets.processor);
  await engine.assetsFor();
  assert.equal(scripts.length, 2);
  assert.deepEqual(files, ['apa.csl', 'locales-en-US.xml']);
});
