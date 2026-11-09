# Helpers

Small, mostly pure modules used across the engine. Fonts are here, as are theme CSS helpers. Back to [site developer guide](README.md).

## General helpers

| File | Exports (main) | Notes |
|---|---|---|
| `util.ts` | `esc_html`, `esc_attr`, `to_entities`, `json_ascii_pua`, `split_list`, `short_hash`, `sha256`, `unique`, `normalize_path`, `parent_path`, `path_depth` | Private-use icon characters are written as numeric entities (HTML) or `\uXXXX` (JSON in `<script>`) so output stays ASCII |
| `paths.ts` | `inside`, `output_directory`, `output_file` | **Every filesystem write/read from user-controlled paths goes through `inside()`**; also resolves junctions so builds/cleans cannot escape the project |
| `diag.ts` | `jazu_error`, `new_diagnostics`, `report_error`, `report_warning`, `fail_on_errors` | `where_of(node)` (xml.ts) gives `file:line` for messages |
| `resources.ts` | `content_file`, `configured_resource`, `published_resource` | Leading `/` = content root; otherwise relative to the declaring file; rejects anything outside `content/` incl. symlinks |
| `dates.ts` | `parse_date`, `format_label`, `year_fraction` | `present` = build month; deterministic with `--date` |
| `era.ts` | `era_of`, `era_of_month` | Japanese era names for the 履歴書 |
| `icons.ts` | `load_icons`, `next_codepoint`, `add_icon`, `expand_tokens`, `icon_chars` | `[token]` expansion; append-only registry in `config.json` |
| `mime.ts` | `mime_table`, `mime_from_name`, `mime_info_of`, `mime_siblings` | Extension ↔ mime for resources and windows |
| `gitignore.ts` | `parse_ignore`, `is_ignored`, `collect_unignored` | Own `.gitignore` implementation used by `pack` (no git needed); always skips `.git`, `node_modules` |
| `raster.ts` | `svg_to_png`, `build_ico`, `png_size` | `@resvg/resvg-js` for icons and covers |
| `prints.ts` | `select_print`, `print_person` | Choose `<print>` by language; collect published personal data from the first hero |
| `config.ts` | `site_config`, `default_config`, `load_config` | Defaults + validation (see [content README](../content/README.md#4-configjson-non-content-settings)) |
| `compare_css.ts` | – | Dev utility (`npm run compare`) for CSS comparison/measurement |

## <a id="themes-and-fonts"></a>Themes and fonts

### Theme CSS (`theme_css.ts`, `layout_css.ts`)

- `compile_theme()` compiles the theme's `<style>` SCSS with `sass`, injects the virtual module `jazu:api` (palette variables, `mode_light`/`mode_dark`/`mode_auto` mixins, generated expertise state data from `scss_data()`), scopes rules via `scope_selector`/`scope_css` under `:root:where([data-theme="name"])`, lifts `@font-face`/`@keyframes`, hashes asset references, minifies, and emits `assets/themes/{name}.{hash}.css` plus optional script.
- `compile_inline_layout()` builds the unnamed theme: `split_layout_css()` separates **geometry** (`layout`, shared by all themes via a low-priority CSS layer) from **paint** (`skin`, Default only).
- `tests/layout.test.ts` guarantees shared geometry keeps responsive state without importing a palette, and that inline styles get their own CSP hash.

### Font pipeline (`font_build.ts`, `font/binary.ts`, `font/outlines.ts`)

TypeScript only (no Python). `build_font()` resolves `<sym>` glyphs (`decode_char`: single char, hex codepoint or `[token]`; duplicates and multi-character strings are errors), converts SVG paths to outlines (`outlines.ts`, using `svgpath`; y flipped, no auto-scaling), and `binary.ts::encode_font` writes the OpenType tables (`head`, `hhea`, `maxp`, `OS/2`, `hmtx`, `cmap`, `name`, `post`, outlines, plus COLR/CPAL) then WOFF/WOFF2 with Node's zlib/Brotli. `emit_font()` writes hashed files and `@font-face` CSS (`font_face_css`). Palettes: 0 = light, 1 = dark (CSS `font-palette`).

- Formats today: monochrome base + COLRv0/CPAL, WOFF2, WOFF. **Not implemented:** COLRv1 gradients, OpenType-SVG/bitmap glyphs, contextual alternates (`calt`).
- Output is **reproducible for a pinned build date** (timestamps are fixed to it); `tests/font.test.ts` decodes the output independently with `fontkit`.
- `config.font_formats` selects formats (default `colrv0, woff2, woff`).

### Adding or changing a glyph

Edit the theme XML (`content/theme/default/default.xml`): add/modify `<sym char="…" path="…">`. Check it with `npm run check` (glyph coverage) and `npm run icons`. For registry icons first `node src/main.ts icons add <name>`.
