# Migration notes and design decisions

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** *(reference only)*
- **Related guides:** [docs/README.md](../README.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Keep all work on `migration/gen-11-to-gen12`; preserve gen-11 as an ignored reference
- [x] Copy engine, content, themes and helpers without `.env`, Git history, caches or dependencies
- [x] Move CLI to `src/main.ts`, generators to `src/web`, browser runtime to `src/web/client`, local server to `src/node`
- [x] Rename internal events, modules, CLI and browser storage identifiers to `jazu`
- [x] Reproducible npm install, type checking and root build commands
- [x] Conventional Commits for each validated state
- [ ] Owner: analyse and monitor the migration, then merge to master manually

## Reference

## 6. Changes from the existing (generation 11) codebase

| Area | Existing | Target |
|---|---|---|
| Content structure | Folders such as `pages`, `themes`, `home_jason` carry meaning | No fixed structure (1.0) |
| Landing, contact, error | `<landing>`, root `<contact>`, separate error sections | One `<hero>` (1.2); the greeting belongs to the theme |
| Contact entries | nested `<contact>` | `<item>` |
| Expertise | `<skill>`, `<stack>`, `<event>` written inside `<expertise>` with `featured_chips` | Expertise generated from the whole website (1.3); vocabulary and events are top-level content |
| Projects and events | Ordinary `<page>` elements with many attributes | `<project>` and `<event>` generators (1.5, 1.6) |
| Desk side panel | `<side>` | `<menu>` |
| Desk map | none | `<map>` inside `<menu>` (1.4.3) |
| Window modes | `text`, `view`, `edit` | `view`, `edit` only; use mime to choose bytes or text. `keep` removed, `save` writes to the filesystem |
| Window paths | `shell:N`, `pid:N` | `pid://name` and `pid:N` |
| Desk tools | `wasm/registry.json` | `<plugin>` (1.10) |
| API path | `/api/{resource}/{version}` | `/api/{version}/{resource}/{id}/{subresource}` |
| Source layout | flat `src/`, `client_*.ts` | `src`, `src/web`, `src/web/client`, `src/node`, `src/desk` |
| Names | `jasouza` identifiers and files | `jazu` (synthetic root, virtual module, CLI) |
| Configuration | Scattered, in `package.json` and code | `config.json` (secrets in `.env`) |
| Cache | Per-file times and hashes | `.cache`: last compiled time, path manifest, graph, fingerprints, repository revisions (2.3) |
| Print | `<resume>`, per-page print styles | `<print>` root and a page's `print` attribute (1.13) |
| Blogs | Plain pages under `/blogs` | `<blog>` generator, files at `/srv/blogs/{id}` (1.7) |
| Skills and stacks | Root or expertise children with fixed lists | Detected from entries, declared and grouped only inside `<expertise>` (1.3) |
| Slides | Fields of the project | `<slide>` children of `<project>`, one per skill (1.5) |
| Filesystem | `/home/{owner}` and `home_jason` | `/srv/blogs`, `/srv/events`, `/srv/repo`, `/home/user`, `/tmp` (3.7) |
| Work | `/work/{client}` admin page, snapshots | One `/work` path, everything client-side (1.8) |
| Rendering | HTML strings in browser and build | Virtual nodes with `to_html` and `to_dom` (2.4) |
| Fonts | Python helper | TypeScript only (2.6) |
| Theme | First paint waits for default theme | Inline skeleton theme (1.9) |
| Page structure | Some theme-specific DOM | Theme-ambiguous DOM only; no DOM created for a theme (2.4.2) |


## 7. Migration decisions

- Existing public URL slugs, skill/stack ids and theme CSS classes are preserved during migration, including inherited hyphens. New internal TypeScript identifiers and new files use snake_case. Changing public slugs requires redirects, not silent renames.
- Font generation uses the TypeScript table writer in `src/font` and Node zlib/Brotli. Existing monochrome WOFF/WOFF2 and COLRv0/CPAL formats are migrated; COLRv1, SVG/bitmap glyphs and contextual alternates are unimplemented and outside finalization. Obsolete Python icon assemblers were removed; authored paths remain in theme XML.
- The engine currently uses Node filesystem/process APIs in multiple modules. Runtime portability remains explicit work. The TSX generators now share virtual nodes between build HTML and browser DOM rendering.
- Supplied media remains a local owner archive, as it was ignored by generation 11. Website assets in `content/assets/` are source-controlled; `content/media/` is entirely ignored. Referenced assets are copied into the build; a clone without the archive reports missing assets.
- The old print form’s sample personal values are discarded. Missing fields stay empty, and the published hero is the only source of personal print details.

- Deployment staging splits oversized media into R2 uploads while small content-hashed media can remain on Pages. The Worker checks R2 first under `/assets/media` and `/assets/wasm`, then falls back to the distinct Pages origin. This preserves one URL regardless of storage tier and handles inherited videos above the Pages upload limit.
- The initial personal node exposes only explicitly allow-listed **public** repositories over signed read APIs. Native Git clone/push, contributor authentication and private repositories require the later authorization/transport work. No repository location is published into static content.
- Client UUID bearer values are represented as hashes in the initial SQL schema (`uuid_hash`), improving the original plan to store a UUID secret directly. The API that claims/rotates them remains planned.

- The migrated featured fragment remains `#expertise/{project_id}` while skill fragments remain `#{skill}/{project_id}`. The planned `#all/{project_id}` and radio-based filtering are part of the remaining expertise transition; existing bookmarked fragments stay usable.
