# Self-hosted brand fonts

Variable-weight woff2 instances of **Oswald** (wght 500–700) and
**Inter** (wght 400–700), latin + latin-ext subsets, downloaded from
Google Fonts (fonts.gstatic.com) on 2026-08-13.

Both families are licensed under the SIL Open Font License 1.1, which
permits bundling and self-hosting:
- Oswald © The Oswald Project Authors — https://github.com/googlefonts/OswaldFont
- Inter © The Inter Project Authors — https://github.com/rsms/inter

The `@font-face` declarations live in `src/index.css`; the latin files
are preloaded from `index.html`. To update a font, re-download the
woff2 from the css2 API and keep the filenames.
