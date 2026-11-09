# Themes, fonts and the skeleton

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `content/theme/`, `src/theme_css.ts`, `src/layout_css.ts`, `src/font_build.ts`, `src/font/`, `src/web/skeleton_css.ts`, `src/web/client/loading.ts`, `src/web/client/theme_switch.ts`
- **Related guides:** [docs/content/theme.md](../content/theme.md), [docs/src/helper.md](../src/helper.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Compile theme SCSS/XML into scoped, hashed, lazily loaded CSS (2.5)
- [x] Inline shared geometry and mode-aware shimmer; load named themes without blocking first paint, with readable no-JavaScript and failure fallbacks (1.9)
- [x] Diagonal SPA wipes through skeletons, preserve the signature node, isolate named skins with rollback on a failed theme change
- [x] Default and Memory themes exist
- [x] Port monochrome/COLRv0 fonts to TypeScript with native Node compression (2.6)
  - [x] Independently decode TTF, WOFF, WOFF2, COLR and CPAL; verify BMP/astral mappings, metrics and reproducibility
- [x] Remove obsolete Python icon assembly scripts; keep all authored outlines in theme XML
- [x] ~~Retain the Python font compiler~~ superseded by the Node-only requirement
- [ ] Replace the legacy theme background trees/renderers with the shared fixed canvas/slots contract (2.4.2)
- [ ] COLRv1 gradients, OpenType-SVG/bitmap glyphs and contextual alternates (`calt`) — unimplemented, outside finalization
- [ ] Further themes: Frutiger Aero, Punk, later vaporwave, inkblot, art nouveau

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.9 Theme `<theme>`

**Objective.** Change the whole visual identity of the website (layout, colors, text and icon glyph shapes, motion) without changing any DOM, so themes can be compared and chosen by preference, and so a page is never blank while a theme loads.

**Solution.** A theme is CSS, fonts and an optional script. It may only style the fixed DOM, the empty slots and the shared canvas (2.4.2); it never creates DOM. Every theme provides light and dark modes. Switching swaps CSS, fonts and script only; because all themes share one canvas and the same slots, a transition between themes can animate through them continuously.

**The unnamed theme (skeleton).** A `<theme>` with an empty `name=""` or no `name` is not a selectable theme: its style is written **inline into the HTML of every page**. It supports light and dark mode and paints a **skeleton loading animation** over the real content (the engine knows what content exists and how it is laid out, so the placeholders match it). Visitors therefore never wait on an empty page, and a dark-mode visitor is never hit by a blank white one. It is deliberately tiny because it is in every HTML file. When the real theme has loaded (`html.theme_ready`), the skeleton slides off to reveal the content. Without JavaScript the real stylesheet is linked normally and no skeleton is needed.

**Interface.**

| Element | Attributes | Meaning |
|---|---|---|
| `<theme>` | `name` (empty = skeleton), `color` (browser chrome color, light/dark pair allowed), `js` (module path), `background` (a partial HTML file) | Root |
| `<font>` | `name`, `size` (`WxH`, e.g. `60x100`), `role` (`display`, `body`, `mono`, `icon`) | One generated font |
| `<palette>` | `mode` (`light` or `dark`), `colors` (hex list) | A color table for multi-color glyphs |
| `<sym>` | `char`, `path`, `img`, `width`, `name`, `variant` | One glyph. `char` is one character, a 4-6 digit hex codepoint, or a `[token]`. `path` alone is a single-color glyph; with `<layer>` children it is multi-color; `img` is a bitmap glyph. Repeating `char` with different `variant` defines alternates (ransom-note fonts) |
| `<layer>` | `path`, `color` (palette index or `#rrggbb`), `paint` (gradient) | One color layer of a glyph |
| `<style>` | `src`, `media`, `scope` | SCSS in CDATA or a file. Scoped under `:root[data-theme="name"]` unless `scope="global"` |

SCSS receives the compiler's virtual module `jazu:api` (palette variables, `mode_light`, `mode_dark`, `mode_auto` mixins, and the generated expertise state data). A theme script exports `mount(root, options)` receiving the shared canvas and slots and returning `fade_in`, `fade_out`, `pause`, `resume`, `dispose`; it draws and animates but never creates DOM. Every theme's CSS shows a CSS-only approximation of its background; the script replaces it.

Planned themes (the system is designed for any number): **Default** (sci-fi, clean, vectorized, dithering, contour map, rotating globe, glass), **Memory** (weirdcore/dreamcore, nostalgic operating-system look, ransom-note text), **Frutiger Aero**, **Punk**, and later vaporwave, inkblot and art nouveau. Themes use original assets only.

### 2.4.2 Slots and shared canvas

**Objective.** Let any theme decorate and animate without creating DOM, and let themes hand over to each other fluently.

**Solution.** The engine emits empty elements in configurable groups (default `background_entity` and `foreground_entity`, ten each, numbered `_00` upward) and one shared canvas in the background layer. Themes style the slots with CSS and pseudo-elements and draw on the same canvas, so a theme switch keeps the same elements and the new theme continues from where the old one is. Raising the count never breaks existing themes.

## 2.5 Theme compiler

**Objective.** Turn theme XML and SCSS into scoped, hashed, lazy-loadable CSS.

**Solution.** Compile SCSS with `sass`; inject the virtual `jazu:api` module; scope every rule under `:root:where([data-theme="name"])` (low specificity so themes coexist and a fading theme can overlap the next); lift at-rules (`@font-face`, `@keyframes`) out of the scope; hash asset references; emit light and dark logic through the `mode_*` mixins and the `data-mode` attribute (`auto`, `light`, `dark`). CSS follows a block-element-modifier naming scheme and is written so most selectors are O(1): state is held by input elements or by a class on a parent and by IDs. Compression and rule-by-rule comparison tools exist for development.

## 2.6 Font and icon pipeline

**Objective.** Render text and icons from generated fonts, so changing a theme's look is changing a font file, not generating SVG in JavaScript, with no language other than TypeScript in the toolchain.

**Solution.** A TypeScript font builder (`src/font`) that writes the font binary itself: a small OpenType table writer for the tables a font needs (`head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap`, `name`, `post`, outlines, plus the optional color and layout tables below), then WOFF2/WOFF packaging with the runtime's built-in compression. For each `<font>`:

1. Resolve glyphs (single character, hex codepoint, or registry token; duplicate codepoints are errors; multi-character strings are rejected so no accidental ligatures occur).
2. Convert SVG path data to outlines with y flipped and no auto-scaling; metrics from the cell size (`units_per_em` is the cell height, advance is `width` or the cell width).
3. Build monochrome base outlines (so every file is a valid plain font).
4. Build color layers: COLRv0 with CPAL (baseline), optionally COLRv1 with gradients, optionally OpenType-SVG.
5. Build palettes (palette 0 light, palette 1 dark, selected in CSS with `font-palette`).
6. Build contextual alternates (`calt` substitutions) for variant glyphs.
7. Serialize WOFF2, WOFF and optional TTF with hashed names; emit `@font-face` rules as cascading declarations (never unknown `tech()` syntax inside a shared `src`).

**Format ladder** (best first): COLRv1, OpenType-SVG, COLRv0 plus CPAL (baseline), monochrome WOFF2/WOFF, system font fallback. Every icon-only control also has a text label that stays available to assistive technology.

**Checks.** Every registry icon exists in the default theme; no duplicate codepoints; glyphs inside the cell; lookalike glyphs (I, l, 1, O, 0) are distinct; icon contrast in light and dark is at least 3:1.

## 3.4 Theme switcher

**Objective.** Change theme and mode smoothly and safely.

**Solution.** Lazy load the theme's CSS, fonts and script; fade out the old theme on the shared canvas; set `data-theme`; update both browser-chrome color tags; save the choice locally; fade in the new theme from the same canvas and slots; announce the change. Mode `auto` follows the system.
