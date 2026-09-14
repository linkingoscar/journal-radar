# Bundled citation assets

Retrieved 2026-09-14. Assets are served from this site and included in the offline shell.

* `radar/web/citeproc.js`: Juris-M/citeproc-js, commit `cc9153c45293af878de08cafddbefe6ea150c380`, upstream `citeproc_commonjs.js`. Source: https://github.com/Juris-M/citeproc-js/tree/cc9153c45293af878de08cafddbefe6ea150c380 . The only local change guards the final CommonJS export for browsers. Copyright Frank Bennett; used under CPAL 1.0. The upstream dual-license notice, CPAL, and AGPL texts are included alongside the source. The citation dialog includes the required attribution phrase and URL.
* `radar/web/apa.csl`: Citation Style Language styles, commit `762652456b2b7a657ac0389b85190b8fdfc31b96`. Source: https://github.com/citation-style-language/styles/blob/762652456b2b7a657ac0389b85190b8fdfc31b96/apa.csl . APA Style 7th edition; unmodified, authors and CC BY-SA 3.0 license recorded in the file.
* `radar/web/locales-en-US.xml`: Citation Style Language locales, commit `a89adece41013402236e2c9020972d7e931fbab8`. Source: https://github.com/citation-style-language/locales/blob/a89adece41013402236e2c9020972d7e931fbab8/locales-en-US.xml . Unmodified, CC BY-SA 3.0; attribution retained in the file.

When updating these assets, run `node --test radar/test_citations.cjs` and check real single/batch citations in the browser, including long author lists, article numbers and year-suffix consistency. Source titles are preserved; the editor lets readers correct sentence case while retaining proper nouns. Only an explicitly confirmed advance-online status adds that publication label.
