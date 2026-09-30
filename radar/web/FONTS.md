# Bundled web fonts

Three subsetted WOFF2 files live in `radar/web/` and are served from the same
origin as the site, so the Content-Security-Policy in `index.html` stays at
`default-src 'self'` and no third-party font request is ever made.

| File                          | Family                    | Source                                                                 |
| ----------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `inter-var-latin.woff2`       | Inter Variable 4.1        | <https://github.com/rsms/inter>                                        |
| `source-serif-var-latin.woff2` | Source Serif 4 Variable 4.005 (roman) | <https://github.com/adobe-fonts/source-serif>          |
| `source-serif-var-italic-latin.woff2` | Source Serif 4 Variable 4.005 (italic) | same release                     |

Total 190.4 KB. Both families are licensed under the SIL Open Font License 1.1.

## How these files were produced

The upstream release archives were downloaded and subsetted with fontTools. The
original files are not redistributed here; only the derived subsets are.

- Weight axis limited to `wght` 400–700 so headings reach 600/700 without faux bold.
- Optical size axis pinned to a single value, which removes one variable-font
  axis and roughly halves the file size. This trades the display-size
  letterform tuning for size; the 32–44 px hero text is the only place the
  difference is visible.
- Character set limited to `U+0020-024F`, `U+0370-03FF`, `U+1E00-1EFF`,
  `U+2000-20AF`, `U+2190-22FF`, `U+FEFF` and `U+FFFD`. CJK is deliberately
  excluded and rendered by the platform font, which is what keeps the files this
  small. Greek and the math block are included because beta coefficients, alpha
  levels and mu means are routine in the management literature this tool tracks;
  adding them cost 49.6 KB and removed 15 beta glyphs that would otherwise have
  rendered in a different face mid-sentence.
- Hinting and glyph names dropped; OpenType features limited to
  `kern`, `liga`, `calt`, `ccmp`, `locl`, `mark`, `mkmk`.

Coverage was checked against the real corpus: of 3,088,400 characters in
`site/data.json`, only 3 distinct characters fall back to the platform font, and
all three are CJK surnames. Nine occurrences render from a fallback face inside
serif text because the upstream families ship no glyph for U+00AD, U+2011,
U+2016, U+03F5 or U+FEFF; four of those are zero-width or a soft hyphen.

To regenerate after a font upgrade, repeat the download, limit `wght` to
400–700, pin `opsz`, subset to the ranges above, and write the results back
with these filenames. `radar/verify_site.py` asserts all three exist, so a
missing or renamed file fails the build instead of silently falling back to a
system font.

## Why self-hosted

`index.html` declares `default-src 'self'; style-src 'self'` with no `font-src`
directive, so a `<link>` to Google Fonts would be blocked by `style-src` and any
externally hosted font file would be blocked by `default-src`. Serving the fonts
from the repository keeps the policy tight, works offline through the service
worker precache, and avoids the third-party request.

## Licenses

Inter — Copyright (c) 2016 The Inter Project Authors.

Source Serif 4 — Copyright (c) 2014–2023 Adobe (http://www.adobe.com/), with
Reserved Font Name 'Source'. Both are distributed under the SIL Open Font
License, Version 1.1. The full license text is published at
<http://scripts.sil.org/OFL> and ships with each upstream release.
