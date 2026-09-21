# Journal library resources

The journal library adapts the cover/body/badges card layout from the user's
[paper repository](https://github.com/linkingoscar/paper), at commit
`0556132ad46fc95b135791062a9c71357111e4cf`, as requested by the repository owner.

`web/catalog.js` initially used a selected subset of `js/journals.js`, matched to
the original 78 tracked journals by ISSN or normalized journal title. It supplies disciplines
and the source dataset's ABS 2024 / FMS Global 2025 labels; these are references
from that dataset, not newly verified rankings. FT50 and UTD24 membership remains
controlled by Journal Radar's current registry.

The original 76 `web/cover-<ISSN>.*` files copy the corresponding `data/covers_en/` image without
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

## Additional covers from BrowZine / Third Iron

On 2026-09-21, the 19 remaining empty cover entries were filled using the
registered ISSN and original PNG artwork from Third Iron's public image assets.
This includes Personnel Review and Asia Pacific Journal of Human Resources,
which were absent from the original dataset, and 17 marketing/consumer additions.
All 95 currently tracked journals now have local cover artwork; the original
76 files and existing disciplines/ratings were retained.

Each downloaded file was decoded as an image and visually checked against the
journal title. Files are stored unchanged in `web/cover-<ISSN>.png` (139,304 bytes
in total), so displaying or caching them does not require a runtime request to
Third Iron. The existing service worker includes all catalog covers for offline
reading; unknown personal journals or image load failures retain the title fallback.

These are representative cover thumbnails, not a promise of the latest issue
or a source of historical issue artwork. Artwork retains its original rights;
the repository's code license does not grant rights to third-party covers.
Third Iron's [official API documentation](https://thirdiron.atlassian.net/wiki/spaces/BrowZineAPIDocs/pages/65798203/Search+Endpoint)
describes `coverImageUrl` as a small journal-identification image and restricts
formal API access to subscribing institutions. This update did not use that API.

| Journal | ISSN | Original image |
| --- | --- | --- |
| Personnel Review | 0048-3486 | [PNG](https://assets.thirdiron.com/images/covers/0048-3486.png) |
| Asia Pacific Journal of Human Resources | 1038-4111 | [PNG](https://assets.thirdiron.com/images/covers/1038-4111.png) |
| International Journal of Research in Marketing | 0167-8116 | [PNG](https://assets.thirdiron.com/images/covers/0167-8116.png) |
| Journal of Retailing | 0022-4359 | [PNG](https://assets.thirdiron.com/images/covers/0022-4359.png) |
| Journal of Personality and Social Psychology | 0022-3514 | [PNG](https://assets.thirdiron.com/images/covers/0022-3514.png) |
| Journal of the Association for Consumer Research | 2378-1815 | [PNG](https://assets.thirdiron.com/images/covers/2378-1815.png) |
| Psychology & Marketing | 0742-6046 | [PNG](https://assets.thirdiron.com/images/covers/0742-6046.png) |
| Journal of Consumer Behaviour | 1472-0817 | [PNG](https://assets.thirdiron.com/images/covers/1472-0817.png) |
| Marketing Letters | 0923-0645 | [PNG](https://assets.thirdiron.com/images/covers/0923-0645.png) |
| Journal of Advertising | 0091-3367 | [PNG](https://assets.thirdiron.com/images/covers/0091-3367.png) |
| Journal of Interactive Marketing | 1094-9968 | [PNG](https://assets.thirdiron.com/images/covers/1094-9968.png) |
| Journal of Public Policy & Marketing | 0743-9156 | [PNG](https://assets.thirdiron.com/images/covers/0743-9156.png) |
| European Journal of Marketing | 0309-0566 | [PNG](https://assets.thirdiron.com/images/covers/0309-0566.png) |
| International Marketing Review | 0265-1335 | [PNG](https://assets.thirdiron.com/images/covers/0265-1335.png) |
| Journal of Retailing and Consumer Services | 0969-6989 | [PNG](https://assets.thirdiron.com/images/covers/0969-6989.png) |
| Journal of Brand Management | 1350-231X | [PNG](https://assets.thirdiron.com/images/covers/1350-231X.png) |
| International Journal of Consumer Studies | 1470-6423 | [PNG](https://assets.thirdiron.com/images/covers/1470-6423.png) |
| International Journal of Advertising | 0265-0487 | [PNG](https://assets.thirdiron.com/images/covers/0265-0487.png) |
| Computers in Human Behavior | 0747-5632 | [PNG](https://assets.thirdiron.com/images/covers/0747-5632.png) |
