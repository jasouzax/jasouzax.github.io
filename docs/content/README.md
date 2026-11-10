# Content developer guide

For the people who maintain `content/`: pages, projects, events, blogs, themes, plugins, print layouts, media and wording. You never need to touch `src/` to publish new content. If a build fails, the error names the file and line.

Per-tag rules (every attribute, child, and what the validator enforces):

| Tag | Page | Becomes |
|---|---|---|
| `<page>` | [page.md](page.md) | A URL |
| `<hero>` (`<item>`, `<action>`) | [hero.md](hero.md) | Landing / contact / error / sitemap header block |
| `<expertise>` (`<skill>`, `<stack>`) | [expertise.md](expertise.md) | Timeline, search and slideshow vocabulary |
| `<desk>` (`<menu>`, `<entry>`, `<foot>`, `<window>`, `<map>`) | [desk.md](desk.md) | A desktop-like workspace |
| `<project>` (`<slide>`, `<research>`) | [project.md](project.md) | `/projects/{id}` + expertise slides |
| `<event>` | [event.md](event.md) | `/events/{id}` + timeline entry |
| `<blog>` | [blog.md](blog.md) | `/blogs/{id}` |
| `<theme>` (`<font>`, `<sym>`, `<style>` …) | [theme.md](theme.md) | A selectable look (or the inline skeleton) |
| `<plugin>` (`<case>`) | [plugin.md](plugin.md) | A desk capability |
| `<print>` | [print.md](print.md) | A paper/PDF layout |

The authoritative validator is `src/schema.ts`. These pages describe it in prose; if they ever disagree, the validator wins (and the page should be fixed).

## 1. Ground rules

- **The content team owns the layout of `content/`.** The engine scans every file under it and decides what a file is by its **root tag** (XML) or **extension**. Folder and file names carry no meaning. `content/blogs/`, `content/theme/`, `content/media/` and `content/assets/` are current conventions only.
- **Root tags** an XML file may start with: `page`, `theme`, `project`, `event`, `blog`, `print`, `plugin`. One file may contain several roots, side by side, with no wrapper (the engine wraps the file in a synthetic `<jazu>` element before parsing). Any other root is an error.
- **Routes come from attributes, not filenames.** `<page path="/">` defines a page; `<project id="x">`, `<event id="x">`, `<blog id="x">` generate `/projects/x`, `/events/x`, `/blogs/x`.
- **Translations live together.** One file holds one `<page path="…" lang="en">` and one `<page path="…" lang="ja">` for the same route (same for blogs). The default language lives at the plain path, others at `/{lang}/{path}`. Ids, slugs, dates and skills stay identical across languages; only display text is translated. A missing page falls back to the default-language page; a missing UI string falls back to the default language.
- **Unknown elements and unknown attributes are errors.** So are missing required attributes, wrong booleans, and `javascript:`, `vbscript:` or `data:` URIs in `link`, `href`, `media`, `profile`, `image`, `cover`, `poster`.
- **Secrets never go in `content/` or `config.json`.** They live in `.env` (local) or Cloudflare secrets.
- **Client data never goes in XML.** `/work` is a static shell; everything about a client is fetched at runtime.
- **Do not put private documents in public content.** Anything referenced from XML is published.

## 2. Value types

| Type | Rule |
|---|---|
| `bool` | `true` or `false`. **Valueless form**: `<window full save/>` means `full="true" save="true"`. Write `="false"` to switch one off. Only start-tag attributes are expanded; text, quoted values, comments and CDATA are untouched |
| `list` | Comma separated, whitespace trimmed (`skill="web-app, cloud"`) |
| `date` | `2024`, `May 2024`, `May 23, 2024`, or a range `Aug 2022 - Jun 2026`; `present` as a range end means the build month |
| `uri` | `/path`, `https://…`, `mailto:…`, `file:///…`, `window:N[:/sub]`, `pid://name[:/stream]` |
| `mime` | RFC 6838 media type; wildcards allowed in plugin triggers (`image/*`) |
| `icon` | One character: a registry token `[globe]`, a raw private-use character, an emoji or a letter |

**Text tokens.** In `icon`, `text`, `name`, `info` and `data` values, `[name]` is replaced by the character registered under `name` in the icon registry (`config.json.icons`). Unknown tokens stay literal and raise a build warning. A literal bracket is written `&#91;`.

**Naming.** All identifiers (files, folders, ids you invent) are `snake_case`; XML tag and attribute names are single lowercase words. Exception: public slugs inherited from generation 11 (such as `galactic-strike`, `web-app`) keep their hyphens, because changing a public slug needs a redirect.

## 3. Where resources are found

- Relative references (`path="intro.md"`, `media="pic.png"`, `src="theme.scss"`) resolve **from the XML file that declares them**.
- References starting with `/` resolve **from the content root** (`/media/photo.jpg` is `content/media/photo.jpg`).
- A file must stay inside `content/`, including symlink targets.
- **Only referenced files are published.** Unreferenced files in `content/` stay private. A referenced large file is copied into the build only if an XML element names it.
- Published addresses are part of the site's output protocol and do not depend on source folders: `/assets/media/…` (content-hashed), `/srv/blogs/{id}/…`, `/srv/events/{id}/…`, `/icon.svg`.
- Renaming a folder means updating the XML references, any matching `config.json` paths, and `content/.gitignore`.

### Website-wide artwork (`config.json`)

```json
{
  "resources": {
    "signature": "/assets/signature_animation.svg",
    "icon": "/assets/signature.svg",
    "favicon": "/assets/favicon.svg"
  },
  "pack": { "exclude": ["content/media"] }
}
```

- `signature` is the animated header/loading artwork (inlined; the only inline SVG).
- `icon` supplies Apple/PWA icons and generated link-preview covers; it falls back to `signature`, then `favicon`.
- `favicon` overrides the generated browser-tab SVG and ICO.
- Empty paths disable that input; there are no implicit filename or folder searches. Configured paths participate in rebuild tracking.

### Media archive

`content/media/` is ignored by Git (see `content/.gitignore`) and excluded from `npm run pack`. A fresh clone needs the owner's media archive restored there; `npm run check` reports each missing file. Website SVG artwork in `content/assets/` is tracked.

## 4. `config.json` (non-content settings)

Everything that is not an object (page, project …) is in `config.json`. Top-level keys:

| Key | Purpose |
|---|---|
| `resources`, `pack` | Artwork paths and archive exclusions (above) |
| `base_url`, `site_name`, `owner` | Site identity used in meta tags, manifest, JSON-LD, `llms.txt` |
| `languages` | Per-language UI string dictionaries, `config.json.languages.en.<id>` / `.ja.<id>`; keys must match across languages |
| `default_language`, `default_theme`, `themes` | Language and theme selection (`"themes": "all"` builds every theme) |
| `icons` | Icon registry: `snake_case` name → private-use codepoint. **Append-only**: never change an existing codepoint. Manage with `node src/main.ts icons list\|add\|check` |
| `personal_server` | HTTPS origin of the private node (empty until configured) |
| `deploy` | `pages_project` and `worker_name` for Cloudflare |
| `seo` | Description, keywords, Twitter handle, `Person`/`Organization` entity, theme/background colours, brand colours, manifest options, robots (`/work` is disallowed by default), `security.txt` contacts, `llms` summary. Partial blocks are merged one level deep with defaults |
| `slots`, `slot_digits` | Number of empty background/foreground decoration elements emitted for themes (default 10 each) |
| `font_formats`, `render`, `dropdown_limit`, `rebuild_present_monthly`, `sfx` | Engine switches with defaults in `src/config.ts` |

Loaded, merged with defaults and validated in `src/config.ts` (`base_url` must be a bare http(s) origin; `default_language` must exist in `languages`; `default_theme` must be selected by `themes`). `google_client_id` is read from the `GOOGLE_CLIENT_ID` environment variable, not from the file.

## 5. Daily workflow

```sh
npm run watch          # terminal 1: rebuild on content/config change (engine changes need a restart)
npm run serve          # terminal 2: http://127.0.0.1:8080
npm run check          # validate XML, links, media, icon tokens, SEO lengths
npm run check -- --strict   # also fail on warnings
```

Warnings are real editorial findings (missing images, over-long SEO descriptions). The repository intentionally does not suppress them. Current known ones are listed in [../README.md](../README.md#placeholders-the-owner-must-replace).

## 6. Quick reference: which attribute where

| Attribute | `page` | `project` | `event` | `blog` | `slide` |
|---|:-:|:-:|:-:|:-:|:-:|
| `id` | – | ✔ req | ✔ req | ✔ req | – |
| `path` | ✔ req | – | – | – | – |
| `name` | ✔ req | ✔ req | ✔ req | ✔ req | – |
| `date` | ✔ | ✔ req | ✔ req | ✔ | – |
| `info` | ✔ | – (use slide `info`) | ✔ | ✔ | ✔ |
| `skill` | ✔ | – (use slides) | ✔ | – | ✔ req |
| `stack` | ✔ | ✔ | ✔ | – | ✔ |
| `lang` | ✔ | ✔ | ✔ | ✔ | – |

(`page`, `project` and `event` share a common attribute pool defined in `src/schema.ts` as `page_attrs`; see each tag's page for the exact list.)
