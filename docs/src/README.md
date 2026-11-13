# Site developer guide (`src/`)

For people (and AI agents) changing how the website is **built, rendered, run or deployed**. Content authors should read [../content/README.md](../content/README.md) instead.

| Area | Guide | Code |
|---|---|---|
| Build pipeline, CLI, cache, checks | [engine.md](engine.md) | `src/main.ts`, `commands.ts`, `build.ts`, `model.ts`, `objects.ts`, `schema.ts`, `xml.ts`, `expertise.ts`, `graph.ts`, `cache.ts`, `check.ts`, `plugins.ts` |
| Static site generation (TSX) | [web.md](web.md) | `src/web/*.tsx`, `src/web/partials/` |
| Browser runtime | [client.md](client.md) | `src/web/client/*.ts` |
| Desktop (`desk`): kernel, shell, WASM programs | [desk.md](desk.md) | `src/desk/`, `src/web/client/{kernel,wasm_*,desk_*}.ts` |
| Nodes: Worker, personal server, local server, deploy | [node.md](node.md) | `src/node/` |
| Encrypted Work chat | [Work contract and setup](../feat/work.md#encrypted-messaging-implementation) | `src/work_crypto.ts`, `src/node/work.ts`, `src/web/client/desk_messages.ts` |
| Helpers: paths, util, dates, icons, mime, fonts, theme CSS | [helper.md](helper.md) | `src/util.ts`, `paths.ts`, `diag.ts`, `dates.ts`, `era.ts`, `icons.ts`, `mime.ts`, `gitignore.ts`, `raster.ts`, `font_build.ts`, `font/`, `theme_css.ts`, `layout_css.ts` |
| Infrastructure as code | [../infra.md](../infra.md) | `terraform/`, `migrations/`, `wrangler.local.jsonc` |
| Tests | [tests.md](tests.md) | `tests/` |

## Layout of the repository

```
config.json              site/owner/languages/icons/slots/seo/deploy settings (no secrets)
.env  (ignored)          secrets and operator settings; template: .env.example
content/                 everything the content team owns (XML + media + SCSS + md)
src/
  main.ts                tiny launcher: registers tsx, imports commands.ts
  commands.ts            CLI: build/check/serve/watch/clean/icons/graph/pack/deploy/node
  build.ts               build_site(): the whole generation pipeline
  model.ts               load_site(): files → site_model (pages, themes, objects, prints, plugins, resources)
  objects.ts             generators: project/event/blog → pages, listings, resource collection
  schema.ts              XML rules (tags, attributes, children) — the validator
  xml.ts                 strict XML parsing with line numbers; valueless boolean attributes
  expertise.ts           build-time expertise model: timeline lanes, slides, filters
  plugins.ts, plugin_types.ts   plugin compile + case matching (shared with the browser)
  theme_css.ts, layout_css.ts   SCSS → scoped hashed CSS; shared-geometry extraction
  font_build.ts, font/   TypeScript font writer (TTF/WOFF/WOFF2/COLRv0)
  check.ts               link/media/SEO/page-rule checks and the capability-tier report
  cache.ts, graph.ts     incremental output hashes and dependency graph
  config.ts, resources.ts, paths.ts, util.ts, diag.ts, dates.ts, era.ts, icons.ts, mime.ts, gitignore.ts, raster.ts, prints.ts
  compare_css.ts         dev tool: compare/measure CSS (npm run compare)
  web/                   TSX page generators (build-time) + partials
    client/              browser runtime (bundled with esbuild into assets/runtime/*)
  node/                  Worker, personal node, local static server, deploy, D1 migrate
  desk/                  WASM toolchains (busybox, programs) — the only non-TypeScript code
migrations/              D1 SQL
terraform/               Cloudflare infrastructure
tests/                   node:test unit/contract tests + Playwright browser specs
docs/                    this documentation
dist/, .cache/ (ignored) generated output and incremental state
```

## Principles (also in `CLAUDE.md`)

- **TypeScript everywhere** except `src/desk/*` build recipes (Bash/Python/C for WASM).
- **Only `src/main.ts`/`commands.ts` and `src/node/*` touch runtime-specific APIs** by design; many engine modules still import `node:fs` directly today, so the engine is Node-only for now ([status](../feat/engine.md)).
- **No DOM is created for a theme.** Themes style fixed DOM, slots and the shared canvas.
- **Browser code never parses HTML strings** (target). Build-time markup is serialised vnodes; a few `innerHTML` assignments remain in `src/web/client` ([status](../feat/web.md)).
- **No private data leaves the visitor's browser** on `/desk`; nothing client-specific is compiled into static output.
- **Fail closed**: unfinished cloud APIs return `501`; unknown hosts `404`; unsigned origin requests `401`.
- **snake_case** for functions/variables/files, `Title_Snake_Case` for classes (see `CLAUDE.md` for the full style).

## Data flow in one paragraph

`content/**` + `config.json` → `load_site` (parse, validate, expand generators, collect referenced resources) → `build_expertise` per language → compile plugins, themes (SCSS → CSS, fonts) and the inline skeleton → bundle browser runtime with esbuild (+ BusyBox/program WASM into `assets/wasm`) → render each page with TSX to HTML and to a JSON vnode payload (skipping pages whose hash is unchanged) → write SEO files, icons, covers, `_headers`, `_redirects` → write only changed files to `dist/` and prune the previous manifest. `deploy` stages `dist/` (splitting >25 MiB media for R2), bundles the Worker, and runs Terraform. See [engine.md](engine.md).
