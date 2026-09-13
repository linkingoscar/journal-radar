# Journal library resources

The journal library adapts the cover/body/badges card layout from the user's
[paper repository](https://github.com/linkingoscar/paper), at commit
`0556132ad46fc95b135791062a9c71357111e4cf`, as requested by the repository owner.

`web/catalog.js` contains a selected subset of `js/journals.js`, matched to the
78 tracked journals by ISSN or normalized journal title. It supplies disciplines
and the source dataset's ABS 2024 / FMS Global 2025 labels; these are references
from that dataset, not newly verified rankings. FT50 and UTD24 membership remains
controlled by Journal Radar's current registry.

`web/cover-<ISSN>.*` copies the corresponding `data/covers_en/` image without
alteration. Original filenames are the matched journal titles (including
`The Accounting Review.png`, `Human Resource Management Journal (UK)_a41fb1e22d14.jpg`
and `Manufacturing and Service Operations Management.jpg`). Covers identify the
journal, not the latest issue; publisher artwork retains its original rights.

Cards link to `#journal=<ISSN>`. Journal detail starts at all dates / all reading
states, so entering a journal cannot inherit a hidden article keyword filter.
`#library=<group>` and `#feed=<group>` allow direct links, reload and browser Back.
Library search and grid/list selection are retained while the page remains open.

The user-provided HR/organization list is the `hr35` group (35 journals):
12 previously tracked journals and 23 additions. New ISSNs, Crossref titles
and publishers were checked against the Crossref journal endpoint on 2026-09-13;
registry `sources` retain each verification URL. Industrial and Labor Relations
Review is indexed as ILR Review (0019-7939), per Cornell and Crossref.
New journals use Crossref collection; no unverified RSS URLs are configured.

Personnel Review and Asia Pacific Journal of Human Resources have no cover in
the source dataset; their cards use the existing journal abbreviation fallback.
All 78 journals have catalog metadata; 76 have copied cover artwork.
