# Pages and heroes

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `content/portfolio.xml`, `src/web/html_sections.tsx`, `src/web/html_head.tsx`
- **Related guides:** [docs/content/page.md](../content/page.md), [docs/content/hero.md](../content/hero.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] `<page>` defines one URL with language alternates (1.1)
- [x] Migrate authored landing/contact sections to `<hero>`/`<item>` (1.2)
- [x] Optional hero `tab` label overrides the header tab; visible owner name and published print name stay unchanged
- [x] Landing tabs read Home / ホーム
- [x] Desktop header tabs align right with flexible space after breadcrumbs
- [x] Header separator sits between the head tabs and the account button, honouring right-to-left dropdown direction
- [x] Regression tests cover shared-file language variants, rendered tab labels and header control order

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.1 Page `<page>`

**Objective.** Define one navigable URL, its identity in navigation and search, and its content.

**Solution.** A page is a `<page>` element whose children are components (hero, expertise, desk) that become its sections or tabs. The same `path` may be defined several times with different `lang` values; they are alternates of one page. Pages for projects, events and blogs are generated (1.5-1.7) and need no `<page>`.

**Interface.**

| Attribute | Meaning |
|---|---|
| `path` | URL path, e.g. `/`, `/privacy` |
| `lang` | Language, default is the configured default language |
| `name` | Title; breadcrumb, dropdown and head navigation label |
| `icon` | Icon used in head navigation |
| `rank` | Integer; higher means earlier in navigation order |
| `info` | Description (meta description, tooltip) |
| `menu` | `false` hides the page from dropdowns, suggestions and search |
| `noindex` | `true` removes it from search engine files |
| `print` | Name of the print mode used when printing this page (1.13); empty means the browser default |
| `image`, `cover`, `keywords`, `canonical`, `robots`, `lastmod` | SEO overrides (2.7) |

Children: `<hero>`, `<expertise>`, `<desk>`.

## 1.2 Hero `<hero>`

**Objective.** Give quick, direct information. It serves landing pages, contact sections, sitemaps and error pages with a single component.

**Solution.** One element with a status, a name, rotating tags, a description, a list of links and a list of buttons. Wording such as a greeting ("Hi, I'm") belongs to the theme because it differs between themes. Tags are all rendered and cycled with CSS only; the first tag is the static state. The first hero of the website's landing page is also the only source of personal information for print modes (1.13).

**Interface.**

| Attribute | Meaning |
|---|---|
| `status` | Small status line (e.g. "Available for new projects") |
| `name` | The owner's name on a landing page, or a header for contact, error and sitemap heroes |
| `tab` | Optional header-tab label override; defaults to `name`. The landing hero uses `Home` (`ホーム` in Japanese) |
| `tags` | `list`; the owner's roles on a landing page |
| `info` | Description |
| `profile` | Profile image (also the photo of print modes that use one) |

Children:

- `<item icon name text link print>` - one entry of the link list (contact detail, page, location). `print` is a **label** (`email`, `phone`, `address`, `kana`, `birth`, ...) that print modes look up to find this value; it does not change how the item is shown on screen.
- `<action icon text link primary>` - a button. `primary="true"` highlights it.

- [x] Hero `tab` overrides only the header label; the visible name and published print name remain unchanged.
