# Content directory, strings, configuration and resources

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `content/`, `config.json`, `src/model.ts`, `src/objects.ts`, `src/resources.ts`, `src/icons.ts`
- **Related guides:** [docs/content/README.md](../content/README.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Scan XML recursively anywhere below `content/` and parse multiple strict XML roots (1.0, 2.2)
- [x] Wrap multi-root files in a synthetic `<jazu>` element; one file may hold several roots
- [x] Read owner settings and the append-only icon registry from `config.json` (1.12)
- [x] Keep English/Japanese page and blog roots together in one XML file per authored page/blog, retaining language routes and relative resources (1.11)
- [x] Publish only XML-referenced media and window resources (1.14)
- [x] Resolve relative resources from the declaring XML file and `/…` from the content root
- [x] Preserve translations, SEO, SPA payloads and no-JavaScript HTML
- [ ] Complete transitive Markdown/HTML resource discovery and collision-safe nested relative publication
- [ ] Retire legacy tags still tolerated by `src/schema.ts` and `src/web/seo_text.tsx` (`landing`, `contact`, `error`, `resume`); no content uses them any more
- [ ] Owner: restore the ignored `content/media/` archive and supply the missing Hypro image (see [placeholders](../README.md#placeholders-the-owner-must-replace))

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.0 Content directory

**Objective.** Let the owner maintain a large website by editing plain files in a predictable content layout.

**Solution.** The engine scans every file under `content` and identifies how to interpret it from its type and root tag. All XML root types may live anywhere under `content`, with no required folder names or placement rules. The content team owns that layout; website-wide artwork paths and source-packaging exclusions are declared in `config.json.resources` and `config.json.pack.exclude`. The page's address comes from its attributes. Putting all XML into one file produces the same website as splitting it, apart from relative resource paths. A large media file is only copied into the output if an XML file references it. Keep language variants of the same page or blog together in one XML file, with one root per language; the engine wraps it in a synthetic `<jazu>` element before parsing.

**Interface.**

| Root tag | Becomes |
|---|---|
| `<page>` | A page (1.1) |
| `<project>` | A project page and its workspace (1.5) |
| `<event>` | An event page and its timeline entry (1.6) |
| `<blog>` | A blog post page (1.7) |
| `<theme>` | A theme (1.9) |
| `<print>` | A print mode (1.13) |
| `<plugin>` | A desktop plugin (1.10) |

Skills and stacks are not roots: they are detected from what projects, slides and events reference, and declared only inside `<expertise>` (1.3).

Other files are interpreted by extension: `.md` (text windows and descriptions), `.scss` and `.css` (styles), `.js` (theme or plugin scripts), and media (`.svg`, `.png`, `.avif`, ...). TSX partials live under `src/web/partials`; interface strings live in `config.json.languages` (1.11). Object files are UTF-8 XML with the valueless boolean-attribute extension above; raw text such as SCSS goes in CDATA. Configuration that does not describe an object (pages, projects, ...) is not in `content`; it is in `config.json` (1.12).

- [x] Existing English/Japanese page and blog variants share XML files, retaining one root per language and stable URLs.

## 1.11 Strings and languages

**Objective.** Support many languages without duplicating structure.

**Solution.** A page exists once per language: the same `path` with a different `lang`. The default language lives at the plain path; others at `/{lang}/{path}`. The engine emits `hreflang` alternates and one sitemap entry per language, and generates sitemap pages per language. Interface text (menus, errors) comes from `config.json.languages[lang][id]` string dictionaries with identical keys; a missing key falls back to the default language; a missing page falls back to the default-language page. State generated from the default-language content (ids, slugs, dates, skills) is identical in translations; only display text is translated. A keyword attribute such as an entry `type` is never translated. Print modes match languages the same way (1.13).

## 1.12 Configuration and icon registry

**Objective.** Keep everything that is not an object (pages, projects, ...) in one place, independent of the runtime, and let content refer to icons by stable names.

**Solution.** `{codebase}/config.json` holds all configuration of generation: site and owner metadata used in HTML meta tags, the PWA manifest and structured data; languages and the default; SEO defaults; the icon registry; slot groups and counts; navigation limits; theme order and default; deployment targets; the personal server's address. It is plain JSON, not `package.json`, so switching runtime (Node, Deno, Bun) never touches it. Tokens and other vulnerable values are in `.env`, never in `config.json`.

The **icon registry** (`icons` in `config.json`) maps `snake_case` names to private-use codepoints and is append-only, so a codepoint never changes meaning. An icon is just a character; the engine expands `[name]` to it. A theme missing a registered glyph falls back to the default theme's glyph through font fallback; the default theme must cover every registry entry.

## 1.14 Resource files and media

**Objective.** Let windows, slides and pages use the owner's documents and media without the owner maintaining a separate directory.

**Solution.** Any file referenced by an XML element is taken from `content`, published, and made available through the virtual filesystem (3.7) under the path of its owner: a blog's files at `/srv/blogs/{id}`, an event's at `/srv/events/{id}`; a project's code at `/srv/repo/{id}` comes from its repository. Relative references resolve from the XML file that contains them. Unreferenced files are not published.
