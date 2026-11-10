# `<theme>`, `<font>`, `<palette>`, `<sym>`, `<layer>`, `<style>`

A theme is CSS, generated fonts and an optional script that change the whole look **without changing any DOM**. Back to [content guide](README.md).

## Rules of the game

- A theme may only style the **fixed DOM**, the **empty slots** (`background_entity_00…`, `foreground_entity_00…`; count from `config.json.slots`) and the **shared canvas**. It never creates DOM.
- Every theme provides light and dark modes (`mode_light`, `mode_dark`, `mode_auto` mixins; `data-mode` attribute).
- Switching themes swaps CSS, fonts and script only, so the transition can animate continuously.
- Rules are scoped under `:root:where([data-theme="name"])` (low specificity). At-rules (`@font-face`, `@keyframes`) are lifted out of the scope. Use `scope="global"` on a `<style>` to opt out.
- Use original assets only.

## `<theme>`

| Attribute | Meaning |
|---|---|
| `name` | Theme id. **Empty or missing = the unnamed skeleton theme** (below) |
| `label` | Name shown in the theme switcher (defaults to `name`) |
| `icon` | Icon in the switcher |
| `color` | Browser-chrome colour; a `light/dark` pair is allowed (`#eaf6fb/#05121b`) |
| `js` | Module path; exports `mount(root, options)` returning `fade_in`, `fade_out`, `pause`, `resume`, `dispose`. Draws on the shared canvas; never creates DOM |
| `background` | Selects the decorative background markup: `default` uses `src/web/partials/background_default.tsx`, **any other value uses `background_memory.tsx`** (hard-coded in `background_html()` in `src/web/html_page.tsx`; a genuinely new background needs a small code change) |
| `preload` | Font family to preload |

Children: `<font>`, `<style>`.

### The unnamed theme (skeleton)

`content/theme/layout.xml` is `<theme>` **without a name**. It is not selectable: its CSS is written **inline into every page**. It paints the light/dark skeleton loading animation over real content, and its `scope="layout"` style supplies shared geometry (extracted from the legacy Sass) that named skins inherit through the low-priority `layout` CSS layer. Keep it tiny: it is in every HTML file. Without JavaScript the real stylesheet is linked normally.

### `<style>`

| Attribute | Meaning |
|---|---|
| `src` | SCSS/CSS file (relative to the XML), or write CSS/SCSS in CDATA |
| `media` | Media query for the output |
| `scope` | `global` (unscoped) or `layout` (geometry source for the unnamed theme) |

SCSS can `@use "jazu:api"` — a virtual module with palette variables, the mode mixins and the generated expertise state data.

### `<font>`

Generated at build time to WOFF2/WOFF/COLRv0.

| Attribute | Meaning |
|---|---|
| `name` | **Required.** Font family |
| `size` | Cell as `WxH` (`60x100`); `units_per_em` is the cell height |
| `role` | `display`, `body`, `mono`, `icon` |
| `author`, `src`, `weight` | Metadata, external source, weight |

Children: `<palette>`, `<sym>`.

- `<palette mode="light|dark" colors="#hex, #hex…">` — both attributes required. Palette 0 = light, 1 = dark.
- `<sym char="…" path="…">` — **`char` required**: one character, a 4–6 digit hex codepoint, or a `[token]`. `path` is SVG path data (y flipped, no auto-scaling); `img` is a bitmap glyph; `width` overrides the advance; `name`; `variant` for alternates (repeat `char` with different `variant`). Multi-character strings are rejected so no accidental ligatures occur. Duplicate codepoints are errors.
- `<layer path="…" color="palette-index | #rrggbb" paint="…">` (child of `<sym>`; `path` required) — one colour layer of a multi-colour glyph.

Every icon registered in `config.json.icons` must exist in the default theme's icon font; other themes fall back to it through font fallback. `check` verifies glyph coverage.

## Existing themes

| Theme | Notes |
|---|---|
| `default` | Sci-fi, clean, vectorised, dithering, contour map, globe, glass. SCSS in `content/theme/default/`; background `contour.js` |
| `memory` | Weirdcore/dreamcore, nostalgic OS look, ransom-note text. Supplies its own skin without importing Default |
| *(planned)* | Frutiger Aero, Punk; later vaporwave, inkblot, art nouveau |

Role-label behaviour shared between themes lives in `content/theme/roles.scss`; slide skill colouring in `slide_skills.scss`.

## Related

[Contract and status](../feat/themes.md) · [compiler internals](../src/helper.md#themes-and-fonts)
