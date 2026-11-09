# Static site generation, SEO and the client shell

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/web/*.tsx`, `src/web/vnode.tsx`, `src/web/seo*.tsx`, `src/web/client/{boot,spa,menus,search,scroll}.ts`
- **Related guides:** [docs/src/web.md](../src/web.md), [docs/src/client.md](../src/client.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] TSX page generators with a custom JSX factory returning virtual nodes (`src/web/vnode.tsx`)
- [x] `to_html` (build) and `to_dom` (browser) renderers with regression tests
- [x] SEO: meta, Open Graph, JSON-LD, sitemap, robots, manifest, llms.txt, security.txt, `_headers`, `_redirects`, generated icons and cover images (2.7)
- [x] SPA navigation, search, theme switching, preferences and header menus (3.1–3.4)
- [x] Inline CSS has a generated CSP hash
- [ ] Replace the remaining string renderers with shared safe vnode primitives (2.4). Browser code still assigns `innerHTML` in `pager.ts`, `search.ts`, `desk.ts`, `desk_markdown.ts`
- [ ] Capability-tier report for every shipped CSS/JS feature (`check --report tiers`)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 2.4 Web app generator (`{codebase}/src/web`)

**Objective.** Generate every page as HTML (and as data for client navigation) from the same model, and render dynamic runtime content (menus, messages, files) safely in the browser with the same components.

**Solution.** TSX with a custom JSX factory. The factory does not build strings: it returns small **virtual nodes** (`tag`, attributes, children). Each XML element has one render function (`hero`, `expertise`, `desk`, `window`, ...) that returns virtual nodes. Two renderers consume them:

| Renderer | Runs in | Output | Safety |
|---|---|---|---|
| `to_html` | Build (and on the personal server) | HTML string | Escapes all text and attribute values; raw HTML only through an explicit `raw()` marker used for trusted, first-party generated fragments |
| `to_dom` | Browser | Real DOM with `document.createElement`, `textContent` and `setAttribute` | Never uses `innerHTML`, so runtime data (messages, file names, file contents) cannot become markup |

The same TSX therefore runs on Node (strings) and in the browser (DOM) without a DOM implementation on the server. Static pages are rendered once at build; the browser receives them as HTML for the first load and as compact data (a serialized virtual-node tree, `[tag, attributes, ...children]`) for SPA navigation, and builds the DOM from that data with `to_dom`, so no HTML string is ever parsed at runtime. Dynamic parts (live menus, the message stream, map) run the same components in the browser with `to_dom`.

### 2.4.1 Document skeleton

Every page has the same structure: head (SEO, color scheme, the **inline skeleton style** of the unnamed theme (1.9), theme link loaded without blocking, font preload, inline boot script), background layer (shared canvas plus slots), foreground layer (slots), header, main, footer, cookie notice, no-JS explanation. Names are fixed; themes style them.

### 2.4.3 Header

**Objective.** One navigation structure on every page that themes can lay out freely.

**Solution.** Seven flat sibling parts so any theme can grid-place them:

1. **Menu button** - visible when the page has a desk; toggles the menu.
2. **Skip link** - visible on focus; jumps to main content.
3. **Signature** - the owner's signature card, the only inline SVG, linking home, with a text fallback.
4. **Divider** - the `>` between breadcrumbs; opens the page dropdown.
5. **Breadcrumbs** - path from the root; the last crumb is the page `name`.
6. **Tabs** - the page's sections (hero, expertise, ...) or its windows; a bottom bar in portrait.
7. **Actions** - contextual actions of the focused window plus fixed controls: new window, account, language, theme.

**Dropdown rule.** The divider after crumb C lists C first (marked current when applicable, like `..` in a listing), then C's children (pages exactly one path segment deeper) in the current language. No-JS order: `rank` descending, then name; at most 10 items, then a link to the sitemap. With JavaScript the order is by recent visits (stored locally), and a search field appears when there are more than 10 candidates (3.3). Account, language and theme menus are `<details>` elements; language is plain links and works without JavaScript.

### 2.4.4 Section generators

- **Hero**: renders tags as stacked spans cycled by a CSS keyframe animation; the first tag is static; an accessible label contains the full list.
- **Expertise**: detects entries from events, projects and slides; applies the declared vocabulary; computes at build time, per scenario (all, or each skill): date ranges, axis scale (min and max padded by three months, snapped to years, newest on top), lanes (greedy interval partitioning, lane 0 nearest the axis, extra lanes to the left), equal-spaced indices for portrait, year gridlines, the slideshow order and the version of each slide per skill, and the filter strips (skills of a slide's project, stacks per skill). Each entry carries inline custom properties per scenario (`--top_x`, `--span_x`, `--lane_x`, `--index_x`); CSS picks the scenario by the checked radio. A stack filter hides entries inside the current skill scenario without recomputing positions. All slide versions are in the HTML; the checked skill and the address hash decide which is visible.
- **Desk**: renders static menus and the starting windows as real HTML; pre-renders windows whose source is known at build time (markdown, text, images, code as `<pre>`); renders failsafe snapshots of live menus; emits manual maps as nested link lists.
- **Project, event, blog**: expand into the above.
- **Print**: emits hidden print markup for pages with a `print` attribute (1.13), from the first hero and the expertise only.

### 2.4.5 Page data and output layout

Each page also emits `index.json` containing title, head tags marked for swapping, breadcrumbs, tabs, action context and the main content as a virtual-node tree, used by SPA navigation (3.2).

## 2.7 SEO generator

**Objective.** Make every page discoverable and well presented by search engines, scrapers, browsers and language models, with no per-site SEO code.

**Solution.** Derived entirely from `base_url`, the owner config, the pages and the default theme:

- **Head**: description, keywords (legacy), author, robots, canonical, `hreflang` with `x-default`, Open Graph, Twitter card, JSON-LD (`WebPage`, `ProfilePage`, `BlogPosting`, `SoftwareApplication`, `WebSite`, `BreadcrumbList`, owner `Person` or `Organization`), browser chrome (theme color for light and dark, color scheme, viewport with `viewport-fit=cover`, mobile web app tags, format detection, tile color, manifest, icons). Page-specific tags are marked so SPA navigation swaps exactly those.
- **Icons**: from `config.json.resources.icon` (falling back to configured `signature`, then `favicon`): Apple touch icon, 192, 512 and maskable 512 PNGs, plus generated link-preview cover artwork. `resources.favicon` overrides the generated browser-tab `icon.svg` and `favicon.ico`. `resources.signature` is inlined in the header and loading animation. All paths are content-relative; no directory or filename is implied.
- **Cover images**: every page gets a 1200x630 image drawn with the default theme's own glyph paths; cached; the `og:image` URL carries a content hash.
- **Root files**: `sitemap.xml` (canonical pages, language alternates, `lastmod`), `robots.txt`, `manifest.json` (installable, shortcuts from top pages), `llms.txt` and `llms-full.txt`, `security.txt`, `_headers` (types, caching, CSP hashes), `_redirects`.
- **Lint**: `check` warns on title and description length, duplicates, missing icons or security contact, invalid `lastmod`.

## 2.8 Web app methods

Principles that every generated page follows. Each is a component with its own objective.

| Method | Objective | Solution |
|---|---|---|
| **Accessibility** | Usable on any device by anyone | WCAG 2.2 AA target; keyboard-, remote- and mouse-only operation; skip link; focus moved to the main heading on navigation with a polite live announcement; reduced motion and transparency respected; separators and tabs follow ARIA roles |
| **Compatibility** | Work on modern, legacy and restricted browsers | Three tiers (below); every modern CSS feature has a defined fallback; scripts are classic scripts, not modules, so a wrong MIME type on `.js` does not break them |
| **Multi-theme support** | Show interface designs and honor user preference | Same DOM, switch CSS and fonts only (1.9); no DOM exists for the sake of one theme |
| **Custom fonts for text and icons** | A theme controls glyph shapes, not just colors | Generated fonts (2.6) |
| **CSSOM optimization** | Fast style matching | BEM-like names, O(1) selectors, state on parents or IDs |
| **No-JS navigation** | Usable with JavaScript disabled (Tor Safest) | Radio and checkbox state, anchors as tabs, `<details>` menus, scroll-snap sliders; only truly dynamic features (desk actions, work) need JavaScript and show an explanation without it |
| **SEO** | Discoverability | 2.7 |
| **Single page app** | Instant navigation without losing normal links | The first load is fully rendered; plain left-click on a same-origin link is intercepted and the page's JSON is fetched and swapped in; modified clicks, `target`, `download`, and `/api` links are never intercepted (so open in new tab works) |
| **Progressive web app** | Installable, native-feeling | `manifest.json` and icons; offline support is a design goal of the desktop mode (the offline version of the site) |

**Capability tiers.**

| Tier | Needs | Works |
|---|---|---|
| 0 No JS, baseline CSS | HTML and basic CSS | All content, links, `<details>` menus, anchor tabs, expertise filtering, scroll-row slider, static timeline, print, light/dark from system, default theme |
| 1 CSS enhanced | Modern CSS | Timeline geometry, slider paging, container queries, `dvh`, color fonts and palettes, view transitions |
| 2 JavaScript | `fetch`, History API | SPA navigation, theme switching and canvas, dropdown search, desk, work, sound |

Thresholds are generated, not hand-written: `check --report tiers` scans the emitted CSS and JavaScript, uses browser-compatibility data, and writes each feature with its minimum browser versions, tier and fallback.

## 2.9 Output `{codebase}/dist`

**Objective.** A static website that can be uploaded to any static host unchanged.

**Solution.** Everything is static and `dist` is the host root: HTML and `index.json` per page, hashed CSS, fonts, theme and runtime scripts, WASM and large media prepared for object storage, manifest of the generated home mount, SEO files, `_headers`, `_redirects`. Referenced resources only.

## 3.1 Boot

**Objective.** Set first-paint state before styles apply, without a flash.

**Solution.** A tiny inline script (hash added to the content security policy) that adds the `js` class, marks the intro, restores `data-theme` and `data-mode` from local storage, and loads the real theme stylesheet without blocking so the skeleton (1.9) shows meanwhile; when the stylesheet is ready it sets `html.theme_ready`.

## 3.2 SPA navigation

**Objective.** Make page changes instant while keeping links real.

**Solution.** On an eligible click: fetch `{path}/index.json` with a 3 s timeout (on failure, navigate normally); swap title, SEO tags, breadcrumbs, tabs, action context and main (the content tree is turned into DOM with `to_dom`, never parsed from a string); update history; move focus to the main heading and announce the title; restore scroll (top for new pages, saved on back and forward); never replay the intro; hydrate the new DOM (desk, expertise); prefetch on hover or focus when the connection allows.

## 3.3 Header menus and search

**Objective.** Fast, learned navigation.

**Solution.** Dropdown ordering by recent visits (local only, at most 50), search over `nav_index.json` (path, name, info, rank, language) with a scored subsequence match (name prefix, word prefix, subsequence, info substring), keyboard operation (type, tab to results, Enter follows, Esc closes).
