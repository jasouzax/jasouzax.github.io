# Static site generation (`src/web`)

TSX generators that turn the `site_model` into HTML and JSON. TSX is used so templates read like the markup they produce and changing them is intuitive. Back to [site developer guide](README.md). Status: [../feat/web.md](../feat/web.md).

## How TSX works here

`tsconfig.json` sets `"jsx": "react"`, `"jsxFactory": "jsx"`, `"jsxFragmentFactory": "fragment"`. **There is no React.** `jsx()` in `src/web/vnode.tsx` returns small virtual nodes (`tag`, attributes, children), not strings. Two consumers:

| Function | Where | Notes |
|---|---|---|
| `to_html(node)` | Build time | Escapes all text and attribute values. Raw HTML only via `raw()` from `markup.tsx`, which is a build-only boundary for trusted fragments (signature SVG, Markdown rendered with HTML disabled) |
| `serialize(node)` / `deserialize` | Build → JSON → browser | Compact `[tag, attributes, ...children]` tree stored in each page's `index.json` |
| `to_dom(node)` | Browser | `createElement`/`textContent`/`setAttribute`; never `innerHTML` |

So one component runs on Node (string) and in the browser (DOM) with no DOM implementation on the server. `tests/render.test.ts` covers text, attributes, SVG and `<template>` contents (uses `linkedom`).

## File map

| File | Responsibility |
|---|---|
| `vnode.tsx` | JSX factory, `to_html`, `serialize`/`deserialize`, `to_dom` |
| `markup.tsx` | `raw()` – the only way to inject trusted markup |
| `html_page.tsx` | `render_page()`: `<html>`/`<head>`/body skeleton, theme slots/canvas (`background_html`, `slots`), section tabs, `main_content`, the JSON payload. Hero anchors are `#home`, `#contact`, `#hero_N` |
| `html_head.tsx` | Header (menu button, skip link, signature, divider/breadcrumbs, tabs, actions, theme/language/account menus) and `theme_choices()` |
| `html_common.tsx` | `render_ctx`, `t()` (UI string), `icon()`, `glyph()` helpers |
| `html_sections.tsx` | `render_hero` |
| `html_expertise.tsx` | The expertise component: skill head, search, timeline, slideshow; emits per-scenario CSS custom properties |
| `html_desk.tsx` | Desk, menus, windows, maps; pre-renders window sources (`read_source`, `window_infos`) |
| `html_rirekisho.tsx`, `rireki_form.tsx` | Print layouts: résumé and the Japanese 履歴書 (SVG form coordinates copied from a standard A4 form) |
| `page_style.tsx` | Page-specific `<style src>` handling |
| `skeleton_css.ts` | The tiny inline light/dark skeleton loading CSS |
| `seo.tsx` | Managed `<head>` tags, JSON-LD, sitemap, robots, `_headers` (CSP), `_redirects`, nav index, boot-script hash |
| `seo_common.tsx`, `seo_files.tsx`, `seo_text.tsx`, `seo_images.tsx` | Titles/descriptions, manifest + security.txt, llms.txt, icons and cover images (SVG → PNG via `@resvg/resvg-js`) |
| `partials/` | `background_default.tsx`, `background_memory.tsx` (theme decoration trees), `window_svg_edit.tsx`, `window_video.tsx` |
| `rireki_form.tsx` | 履歴書 form drawing |

## Page structure

Every page has the same head → background (shared canvas + slots) → foreground (slots) → header → main → footer → cookie notice → no-JS explanation. Names are fixed; themes only style them. Header has seven flat sibling parts so themes can grid-place them freely: menu button, skip link, signature, divider, breadcrumbs, tabs, actions.

Each page emits `index.html` and `index.json` (title, head tags marked for swapping, breadcrumbs, tabs, action context, main content as a vnode tree) which the SPA fetches ([client.md](client.md)). `config.render.spa_json` toggles the JSON.

## Security model of generated pages

- All text and attributes are escaped by `to_html`; `raw()` is the single escape hatch.
- CSP (`_headers`) allows `'self'`, `'wasm-unsafe-eval'`, the hash of the inline boot script and the hash of the inline CSS; desk documents additionally need COOP/COEP headers and permit generated style elements for xterm.
- `javascript:`, `vbscript:`, `data:` URIs are rejected by the schema in link-like attributes.
- Page-specific resources are published only if referenced.

## Skeleton / loading lifecycle

`skeleton_css.ts` supplies the light/dark overlay; `src/web/client/loading.ts` coordinates initial loading, SPA wipes and theme changes. Details in [client.md](client.md#loading-lifecycle).

## Recipes

- **Add a section type** (a new child of `<page>`): add the tag to `schema.ts`, a `render_*` function (TSX) returning vnodes, call it from `main_content()` in `html_page.tsx`, add its tab in `section_tabs()`, and make its model part of `page_hash` if it depends on other files.
- **Change header markup:** `html_head.tsx`; themes in `content/theme/**` target the fixed class/ids, so renaming a class means updating every theme SCSS.
- **Add a UI string:** add the key to **every** language in `config.json.languages`; read it with `t(ctx, key)` or `ui_text(model, lang, key)`.
- **Add an icon:** `node src/main.ts icons add <name>` then draw the glyph in the default theme's icon font (`<sym char="[name]" …>`), then `npm run icons`.
