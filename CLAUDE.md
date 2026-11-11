# Project

**JAZU** (JAsouZa User interface) is a file-authored portfolio + browser workspace + technical showcase. The owner writes XML/Markdown/SCSS in `content/`; a TypeScript engine in `src/` validates it and generates a static, multilingual website (`dist/`); a Cloudflare Worker and an optional personal server add dynamic features. Generation 12 (`package.json` version 0.12.0).

**Read first (in this order):** this file → `README.md` (how to run/deploy) → `docs/README.md` (process, placeholders, limits) → `docs/feat/README.md` (what is done / todo) → the specific guide for the area you touch (`docs/src/*.md` for code, `docs/content/*.md` for content rules).

This file is the fast map for an AI session. **Keep it current:** when you learn something that would have saved time (a trap, a shortcut, where something really lives), add it under "Notes & tips" before finishing. Fix wrong statements instead of appending contradictions.

## Commands

```sh
npm ci                       # install (needs network)
npm run types                # tsc --noEmit over src + tests
npm test                     # node:test contract/unit tests (tests/*.test.ts)
npm run check [-- --strict]  # content validation; warnings are real findings
npm run build [-- --date YYYY-MM-DD]   # generate dist/ (incremental; --force to redo)
npm run serve -- --port 8080 # build + http://127.0.0.1:8080
npm run watch                # rebuild on content/src/config change
npm run pack                 # codebase.zip (honours .gitignore; omits *.wasm, *.tar.*, .env, dist, content/media)
npm run deploy:dry           # stage Pages files + Worker bundle + tfvars, applies nothing
npm run db:local / cloud:dev # local D1 migrations / wrangler dev with synthetic bindings
npm run node -- --port 8788  # personal node (needs .env)
npm run test:{desk,loading,expertise}:browser   # Playwright (Chromium)
```

CLI entry is `node src/main.ts <cmd>` (tsx is registered inside `main.ts`; no compile step). Commands: `build check serve watch clean icons graph pack deploy node`.

## Repository map

```
config.json            site/owner/languages/icons/slots/seo/deploy (no secrets). Loaded+validated by src/config.ts
content/               OWNER-MANAGED. XML roots found by tag, anywhere: page theme project event blog print plugin
  *.xml                portfolio, projects, desk, work, privacy …   (names are conventions only)
  theme/               layout.xml = UNNAMED skeleton theme (inlined in every page); default/ memory/ skins; *.scss
  plugins/plugins.xml  default desk plugins; README.md = plugin authoring reference
  assets/              tracked site artwork (signature, icon, favicon) → config.json.resources
  media/               git-ignored owner archive (may be missing → check warns)
src/
  main.ts, commands.ts CLI
  build.ts             build_site(): THE pipeline (see docs/src/engine.md)
  model.ts objects.ts  load_site(); project/event/blog generators; resource collection
  schema.ts xml.ts     THE validator (tags/attrs/children) and strict XML parser
  expertise.ts         build-time timeline/slides model (pure)
  theme_css.ts layout_css.ts font_build.ts font/   SCSS→CSS, geometry split, TS font writer
  plugins.ts plugin_types.ts   plugin compile + case matching (shared with browser)
  check.ts graph.ts cache.ts   checks, dependency graph, .cache/hashes.json
  config.ts resources.ts paths.ts util.ts diag.ts dates.ts era.ts icons.ts mime.ts gitignore.ts raster.ts prints.ts
  web/                 TSX generators (vnode.tsx = JSX factory → to_html / serialize / to_dom)
    html_page.tsx (page shell) html_head.tsx (header) html_expertise.tsx html_desk.tsx html_sections.tsx
    seo*.tsx           head tags, sitemap/robots/_headers/manifest/llms/icons/covers
    partials/          background_default|memory.tsx, window_*.tsx
    client/            browser runtime → bundled to assets/runtime/*.js (boot, spa, loading, desk*, kernel, wasm_*)
  node/                worker.ts (Cloudflare router) security.ts (HMAC) personal.ts (node HTTP) serve.ts deploy.ts publish.ts d1_migrate.ts
                       personal-server hub: server_config git_http git_hooks hook_main git_mirror queue runner ci_jazu server_cli (docs/src/node.md#git-hub)
  desk/                WASM toolchains: busybox/ programs/ (build.sh, port.py, artifacts/). Not TypeScript.
migrations/            D1 SQL (0001_work.sql)
terraform/             Cloudflare infra (Pages, Worker, R2, KV, D1, routes)
tests/                 *.test.ts (node:test) and *.spec.ts (Playwright) + configs
docs/                  README.md (process) · content/ (tag rules) · src/ (code guides) · feat/ (feature checklists) · infra.md
dist/ .cache/ .wrangler/   generated, ignored
```

## Architecture in one screen

1. `load_site` reads `content/**` + `config.json` → `site_model` (`pages`, `themes`, `objects`, `prints`, `plugins`, `resources`, `icons`, `diag`).
2. Generators expand `<project>/<event>/<blog>` into pages; `build_expertise` computes timeline lanes/slides per language.
3. `compile_plugins`, `compile_inline_layout` (skeleton), `compile_theme` per named theme, `bundle_runtime` (esbuild IIFEs + BusyBox/program WASM → `assets/wasm`).
4. `render_page` (TSX → vnodes) → `to_html` for `index.html`, `serialize` for `index.json` (SPA payload). Page skipped if its hash + outputs match `.cache/hashes.json`.
5. SEO files, icons, covers, `_headers` (CSP hashes), `_redirects`; `write_files` writes only changed bytes and prunes via `dist/.jazu_output.json`.
6. Browser: inline `boot` → skeleton → theme CSS → `page` bundle (SPA, search, desk). Desk = kernel + shared VFS + WASM Workers (`wasm_host.ts`).
7. Cloud: Pages serves `dist`; Worker (`src/node/worker.ts`) routes subdomains/`/assets` (R2)/`/api` (health, signed git reads, else 501); optional personal node serves signed Git reads over Tunnel+Access.

## Where do I change…

| Task | Files (then docs) |
|---|---|
| Add/rename an XML attribute or tag | `src/schema.ts` → generator (`objects.ts` / `src/web/*`) → `docs/content/{tag}.md` → test in `tests/migration.test.ts` |
| Page markup / header | `src/web/html_page.tsx`, `html_head.tsx`; themes in `content/theme/**` target these classes |
| Expertise behaviour | `src/expertise.ts` (model) + `src/web/html_expertise.tsx` (DOM) + `src/web/client/expertise.ts`, `search.ts`, `pager.ts` |
| A UI string | `config.json.languages.{en,ja}` (every language) |
| An icon | `node src/main.ts icons add name` → glyph in `content/theme/default/default.xml` |
| Theme look | `content/theme/<name>/*.scss|xml|js`; shared geometry in `content/theme/layout.xml` + `default/default.scss` (scope="layout") |
| Skeleton/loading | `src/web/skeleton_css.ts`, `src/web/client/loading.ts`, `boot.ts` |
| Desk window bodies | `content/plugins/plugins.xml` (cases) + `src/web/client/desk_view.ts` hosts |
| Shell / WASM program | `src/desk/**`, `src/web/client/wasm_*.ts`, `kernel.ts`; docs `src/desk/README.md` |
| Worker route / API | `src/node/worker.ts` (+ test in `tests/nodes.test.ts`); keep `{error:{code,message}}` shape and fail closed |
| Infra | `terraform/*.tf`; deploy glue `src/node/deploy.ts` |
| Fonts | `src/font/*`, `src/font_build.ts`; tests `tests/font.test.ts` |

## Conventions that bite

- **XML:** unknown element/attribute = build error. Valueless booleans (`<window full save/>`) are expanded only in start tags. `project` does **not** accept `skill`/`info` (put on `<slide>`); `<action>` is allowed on `project`/`hero`, not `slide`. Keep language variants in the same file.
- **Paths:** relative = from the declaring XML; leading `/` = content root; everything must stay inside `content/` (symlinks resolved). Use `inside()`/`content_file()` for any user-controlled path.
- **Rendering:** no HTML strings in new code; build TSX vnodes. `raw()` only for trusted build-time fragments. Browser code should use `to_dom`/`textContent`, not `innerHTML` (a few legacy uses remain).
- **Themes never create DOM**; they style fixed DOM, slots (`background_entity_NN`, `foreground_entity_NN`) and the shared canvas. Theme `background` attr: `default` → `background_default.tsx`, anything else → `background_memory.tsx` (hard-coded in `html_page.tsx`).
- **Public slugs keep hyphens** (`galactic-strike`, `web-app`); new internal identifiers are snake_case. Changing a public slug needs a redirect.
- **Privacy:** `/desk` is client-only; nothing client-specific is compiled into static output; `repo` locations and secrets never reach public payloads; print layouts use only the first hero's published data.
- **Fail closed** in the Worker (`501` for unfinished APIs, `404` unknown hosts); personal node requires HMAC-signed GETs.
- **Cache:** `shared_hash` includes the text of every file under `src/`, so any `src/` edit rebuilds all pages (normal). Use `--force` if outputs look stale.
- **Determinism:** pass `--date` when comparing outputs; unchanged pinned-date builds must write 0 files (a test relies on it).
- Generated/ignored: `dist/ .cache/ .wrangler/ .env* *.tfstate terraform.tfvars *.wasm *.tar.* test-results/`.

## Notes & tips (read, and extend)

- **A fresh checkout from `codebase.zip` cannot build** until the ignored WASM artifacts exist: `src/desk/busybox/artifacts/busybox.wasm` + `busybox-source.tar.bz2`, `src/desk/programs/artifacts/{fastfetch,htop,tcc}.wasm` + `*-source.tar.*` + `ncurses-source.tar.gz`. `bundle_runtime()` reads them unconditionally (ENOENT otherwise). `npm run pack` drops them because `.gitignore` ignores `*.wasm`/`*.tar.*` even when git tracks them. `tests/desk_wasm.test.ts` needs them too.
- **Cloud sessions:** network and `npm ci` may be unavailable; without `node_modules` you cannot run tsc/tests/build. Say so honestly instead of claiming verification. Docs-only changes need no build.
- **Legacy residue:** `schema.ts` still accepts `landing`, `contact`, `error`, `resume` tags and `seo_text.tsx` handles them; no content uses them (migration to `hero`/`item` is done). Safe to remove when touching those files.
- **Stale comments:** some file headers mention `client_*.ts` names, `jazu.config.ts`, `<resume format=…>`, `home_jason` — gen-11 names. Trust the code, fix the comment when you are there.
- `README`/docs once claimed "22 regression tests / 68 routes"; the suite has grown. Re-measure before quoting numbers.
- `COMPONENTS.md`, `TASKS.md`, `PLACEHOLDER.md` **no longer exist**. Their content moved: contracts → `docs/feat/{name}.md` (component ids like `1.4` kept; index in `docs/feat/README.md`), checklists → same files + mirrored in `docs/feat/README.md`, placeholders → `docs/README.md`.
- `gen-11/` is mentioned in old docs as an ignored reference checkout; never import from it (not in this repo).
- `.cache/hashes.json` is a flat hash map, not the timestamp/manifest/`HEAD` design the docs describe as the target.
- `schema.ts` `event` rule is defined twice (the second via `Object.assign` wins).
- Existing code style does not fully follow the "block comment at top of each file" rule below; apply it to files you create or substantially rewrite, don't mass-edit.

- **Personal server git/CI:** only `site.project` (`jazu`) is active; all other projects are archived in code (`is_active`). New `src/node/*` files avoid enums/parameter properties so plain `node` (type stripping) can run them, which the generated git hooks and `tests/git_server.test.ts` rely on (`node --test tests/git_server.test.ts`; uses real git, needs no npm install). In tests, git clients that talk to in-process servers must be async (`execFileSync` deadlocks the event loop).
- `ci_jazu.ts` is meant as the template for other projects' pipelines; its steps are data (`jazu_steps`). CI/CD children get a scrubbed env on purpose; test doubles must signal through files, not env vars.
- `content/projects.xml` has a placeholder `<project id="jazu">` (needed so the Worker's `PUBLIC_PROJECTS` includes it and `/projects/jazu` exists). It was added without a build; run `npm run check` and rewrite the text.

## Docs maintenance (do this as you work)

- Changed behaviour → update the matching `docs/**` page. Added attribute → `docs/content/{tag}.md`. New module → `docs/src/*.md` file map.
- Finished a task → tick the checkbox in `docs/feat/{name}.md` **and** the mirrored line in `docs/feat/README.md`; if a feature is fully done, remove it from "Features in development" in `docs/README.md`.
- Never tick a box without evidence (test, command output, browser check).
- Commit messages: Conventional Commits (`feat(expertise): …`). Work on a branch; the owner merges to master.

# Code Style
- **Naming Conventions:** Use `snake_case` naming convention on variables and functions (to be treated like data) but `Title_Snake_Case` on classes or types (to be treated like representations), except on external names *(like libraries, or native/system bilt-ins)*.
- **Indentation & Nesting:** All indents must be in strict increments of 4 spaces. Utilize the Single Responsibility Principle (SRP) to extract logic into seperate entities rather then creating deeply nested, bloated code blocks.
- **Structural Density:** Each line of code must represent a complete instruction with sufficient information. Do not unnecessarily break statements across multiple lines (e.g., separating function declarations from their opening brackets). Empty lines must only be used logically to create structural divides between distinct sections of related code. One line of comment must represent one unique, independent idea. Do not write monolithic paragraph comments that force a developer to read the whole block. If reading a Scope Documentation block, a developer should be able to scan line-by-line (with indented sub-entities) with minimal cognitive overhead.
- **Intent-Based Commenting:** Code should be self-documenting. Only write comments for things the code *cannot* explain: the *why* behind a specific method, upgrade risks, core responsibilities, and specific edge cases handled. So comments are not too frequent as they are used for special cases or warnings.
- **Single Responsibility Principle (SRP):** An entity must have exactly one responsibility. Split overlapping entities or restrict their scopes. Limit the active scope by avoiding single-use variables/functions unless they explicitly help split complex information. This means at the top of every file, provide a block comment documenting the entities within (like JSDoc for). Detail the entity's format, core responsibilities, and strict scope/limitations.
* **UX-Driven Design:** When making design decisions, strictly consider the User Experience. Analyze the user's device, their step-by-step flow to accomplish a task, their focal points, and the intended vibe/theme/emotion.
* **Environment-Aware & Efficient:** Design for the specific runtime environment (native features, hardware constraints, interpreter). Do not reinvent native features.
* **Robust & Secure:** Implement the simplest code that robustly satisfies the requirement (DRY & KISS). Code must fail gracefully, provide meaningful debug context, and sanitize inputs by default.
