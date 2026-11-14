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
extension/             Chromium extension (plain JS, MV3) + native messaging host (host/*.ts, pty_shim.py): real device shell for /desk via `host:`. Not part of the site build; see extension/README.md
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
| Device shell / extension bridge | `extension/**` (+ `src/web/client/desk_host.ts`, `desk_proc.ts`); docs `extension/README.md`, `docs/feat/desk_env.md`; tests `tests/host*.test.ts` |
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

- **Realtime upgrades:** `node/realtime.ts` exports a legacy-compatible Durable Object class (no runtime `cloudflare:workers` import, so Node contract tests can still import the router). Return status 101 directly: rebuilding it in `secure_response` loses its WebSocket. Use hibernation auto-response timestamps for heartbeat leases and alarms, not JS intervals or a D1 write for every ping. Serialize per-socket commands: concurrent watches otherwise overwrite attachments. Version presence snapshots and retain failed fanout in object storage; keep remote fanout outside the projection lock and reschedule alarms using fresh sockets after awaits. New channels belong in `realtime_channels.ts` adapters, not Work-specific branches in the hub. Reconcile presence across all account sockets; a guest replacement closes the old socket.

- **Client fallback keys:** `node/work_unstored.ts` seals client-only recovery bundles in migration 0006's `unstored_keys` using persistent `WORK_FALLBACK_KEY` (Worker secret, independent of D1). Never rotate/regenerate this secret while backups exist. Drive handoff must independently verify the reserved Google file before atomically deleting the row and writing a non-secret completion marker; never delete on the browser's upload claim alone. Guests remain browser-only and the owner remains Drive-only. Fallback mode is server-recoverable, not E2E; old DB backups retain exposure because keys are not rotated.

- **Work presentation:** shared chat geometry belongs in `content/theme/work.scss` (unnamed layout), with theme-specific paint in the named themes. Clients must use `.desk_side_item` entities, not generic lists. Profile images come from verified Google claims or the authenticated matching-subject userinfo backfill, with migration 0005 and a Google-image-host allowlist. Avatar account menus replace the old full-width chat account buttons.
  Chat windows must override the file viewer's `.desk_wbox` overflow on `[data-plugin="messages"]`; only `.desk_messages_log` displays a scrollbar. Keep the textarea's scrollbar hidden even when a long draft reaches its height cap.

- **Opening client windows:** `new_window()` already focuses its result; `activate()` then minimizes it. Use `focus_window()` for client selection (hand off maximization when needed). Open `#head_menu` when revealing Clients so its controls are not covered by the chat window. Browser screenshots after reload must wait for `#main-content` to leave `inert`, otherwise the captured screen can still be the loading skeleton.

- **Guest identity after linking:** `/work/session` must issue a fresh guest cookie after Google sign-out when the previous guest room is bound or closed. Reusing that cookie would prevent a new anonymous room because guest IDs are unique per room. Both SQLite and browser regressions cover linking, signing out, then sending as a new guest.

- **Edge OAuth fetch:** Cloudflare rejects `redirect: "error"` before making a token request. Use `manual` and reject 3xx before reading tokens, so secrets never follow redirects. `tests/auth_runtime.test.ts` exercises bundled auth with real workerd/D1, mocked Google tokens/JWKS and real RSA; Node-only fetch mocks miss this incompatibility. Keep safe `auth_error` codes visible across desk/auth reinitialization.

- **Account controls:** `data-auth="guest|user"` gates header rows; Work uses the same `data-sign="out|delete"` actions. Account deletion uses a CSRF/intent-protected D1 `batch` transaction to revoke all sessions, anonymize/close linked rooms, and remove the profile/admin binding. Preserve shared encrypted history and unrelated clients. Never test deletion against a real user's account; synthetic SQLite/D1 browser fixtures cover confirmation, rollback and tenant isolation.

- **Google authentication:** `node/auth.ts` owns OIDC code/PKCE/nonce and pinned admin sessions (migrations 0003/0004). Google project ownership grants no app role. Sign-in also requests Drive app-data scope; access/refresh credentials are encrypted per opaque session cookie by `google_grant.ts`. The browser receives Drive access in memory only and sends keys directly to Google. Guest linking requires the original guest cookie, verified Google session and CSRF. Browser fixtures use dedicated local D1 state, synthetic HTTPS-source cookies and mocked Drive; actual Google consent remains a user action.

- **Work canonical paths:** Pages redirects `/work` to `/work/`. Use `is_work_path()` in origin forwarding and security wrappers so trailing slashes and `/work/index.json` strip query secrets and retain `no-store`/`no-referrer`, including errors. Keep generated `/work/*` headers equally private. Browser tests must wait for `#main-content` to leave `inert` after boot; otherwise Playwright fill can report success while typing nowhere.

- **Encrypted Work chat:** migration 0004 adds automatic guest-cookie identities, immutable Drive key-file reservations and owner public-key wrapping. `/work` always exposes a composer; no invitation or owner-token login remains. Owner initialization requires real Google Drive app-data consent once. `work_session.ts` manages guest/local, Google/Drive and encrypted client fallback keys; `work_drive.ts` sends keys directly to Google and never overwrites an existing immutable key file. An existing account key prevents guest-history merging. The owner Clients panel opens `im:{email}` / `im:guest/{number}` windows; guest URIs must be recognized in `desk_view.ts`. D1 stores cookie hashes, public/wrapped keys, ciphertext and client recovery bundles sealed by a separate Worker secret. Staging Terraform owns D1/migrations; Pages publication alone cannot update the API.

- **Provider-first clone routing:** Worker `PROJECT_CLONE_ORIGINS` comes from public XML `repo` declarations during Terraform deployment; never put this private routing map into public Pages payloads or forward personal credentials upstream. `git_read_proxy.ts` streams provider reads and redirects failed discovery to the same site's `/_git/pi/` path, pinning subsequent Git requests to Pi. Pushes always use the signed node. Pages CI does not deploy Worker code/bindings; reapply standalone staging Terraform after a routing change. Legacy Workers without the binding retain static clone behavior.

- **Staging infrastructure:** `terraform/staging/` is a standalone root with separate local state; do not apply the production root or import production resources to provision staging. `npm run tf:staging -- plan|apply` bundles the Worker, maps `.env` aliases into child TF_VAR inputs and manages Pages, R2, DNS/domain, Worker routing and secrets. Never generate secret var-files or use Wrangler to overwrite this Terraform-owned Worker. Terraform tests use a mocked provider.

- **Staging pipelines:** multiple `<pipeline>` tags are keyed by unique branch; the first is primary. Use `project_view(config,id,branch)` for branch-specific state/commands and `project_branches()` for polling/authorization. Deployment checkouts are shared and switch only after CI; CI/runtime workspaces are reused, not copied per branch. Never coalesce jobs or deduplicate SHA imports across refs. Secondary branches must not update primary clone mirrors or reuse primary publication state/R2 assets. Engine workers must advertise `branch_pipelines`. The real Jazu staging targets and post-merge instructions are in `docs/infra-staging.md`.

- **Listener upgrades:** `main.ts node` uses the minimal `node/listener_main.ts` entry. Catalogs and pipelines run in fresh `job_main.ts` processes; engine jobs stage their own commit under `<state>/runtime` before parsing XML. Never reintroduce in-process production pipeline/catalog reloads: a cached old schema can reject incoming content. Runtime fingerprints request exit 75 only between jobs; systemd must restart failures. The `isolated:false` runner option and injected `steps` path exist for synthetic integration fixtures only. Regressions are in `tests/listener_process.test.ts`.

- **A fresh checkout from `codebase.zip` cannot build** until the ignored WASM artifacts exist: `src/desk/busybox/artifacts/busybox.wasm` + `busybox-source.tar.bz2`, `src/desk/programs/artifacts/{fastfetch,htop,tcc}.wasm` + `*-source.tar.*` + `ncurses-source.tar.gz`. `bundle_runtime()` reads them unconditionally (ENOENT otherwise). `npm run pack` drops them because `.gitignore` ignores `*.wasm`/`*.tar.*` even when git tracks them. `tests/desk_wasm.test.ts` needs them too.
- **Cloud sessions:** network and `npm ci` may be unavailable; without `node_modules` you cannot run tsc/tests/build. Say so honestly instead of claiming verification. Docs-only changes need no build.
- **Print = blank page trap:** resume/rirekisho markup is emitted `hidden`. The inlined skeleton is `@layer skeleton, layout; @layer layout{…}` and a layered `!important` beats ANY unlayered `!important`, so print CSS can never override `[hidden] { display: none !important }`. `content/theme/layout.xml` therefore exempts `.landing_resume`/`.expertise_resume` from it and hides them in `@media screen` only. Don't add other `!important` layout rules that print needs to beat (see `tests/print_css.test.ts`).
- **Device bridge:** `extension/` is plain JS/TS run directly (no build step; host needs Node ≥ 22.18 type stripping, so only erasable TS syntax: no enums/namespaces). The extension id is fixed by the `key` in `extension/manifest.json`; `extension/host/install.ts` derives it, so never change the key without reinstalling. `tests/host_bridge.test.ts` runs the real `content.js`/`background.js`/`desk_host.ts` in `vm` against the real host (no browser available in cloud sessions). Branded Chrome ≥ 137 ignores `--load-extension`; kiosk docs assume Chromium.
- **Legacy residue:** `schema.ts` still accepts `landing`, `contact`, `error`, `resume` tags and `seo_text.tsx` handles them; no content uses them (migration to `hero`/`item` is done). Safe to remove when touching those files.
- **Stale comments:** some file headers mention `client_*.ts` names, `jazu.config.ts`, `<resume format=…>`, `home_jason` — gen-11 names. Trust the code, fix the comment when you are there.
- `README`/docs once claimed "22 regression tests / 68 routes"; the suite has grown. Re-measure before quoting numbers.
- `COMPONENTS.md`, `TASKS.md`, `PLACEHOLDER.md` **no longer exist**. Their content moved: contracts → `docs/feat/{name}.md` (component ids like `1.4` kept; index in `docs/feat/README.md`), checklists → same files + mirrored in `docs/feat/README.md`, placeholders → `docs/README.md`.
- `gen-11/` is mentioned in old docs as an ignored reference checkout; never import from it (not in this repo).
- `.cache/hashes.json` is a flat hash map, not the timestamp/manifest/`HEAD` design the docs describe as the target.
- `schema.ts` `event` rule is defined twice (the second via `Object.assign` wins).
- Existing code style does not fully follow the "block comment at top of each file" rule below; apply it to files you create or substantially rewrite, don't mass-edit.

- **Personal server git/CI:** projects with XML repo/pipeline declarations are active; other legacy entries remain archived (`is_active`). New `src/node/*` files avoid enums/parameter properties so plain `node` (type stripping) can run them, which the generated git hooks and `tests/git_server.test.ts` rely on (`node --test tests/git_server.test.ts`; uses real git, needs no npm install). In tests, git clients that talk to in-process servers must be async (`execFileSync` deadlocks the event loop).
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

- **Current WASM inputs** live in ignored `build/<package>/`, including `build/busybox/busybox.wasm`, not the older `src/desk/*/artifacts` locations described above. CI restores `build/` and `content/media/` from `site.dir`. Production uses `wrangler.production.jsonc`; import its resources before running Terraform. The hub deploy branch can differ from the working branch using `site.checkout_branch`.

- **Production Git history contains large videos.** `git repack --max-pack-size=20m` can still emit oversized packs for indivisible blobs. `publish.ts` uploads these packs (and oversized site assets) to R2 before Pages; the Worker serves pack ranges from R2. CI on the ARM Pi needs the 10-minute WASM test timeout. Production clone and push were verified; the later Docker service cutover was verified with the original checkout retained (see `docs/feat/docker.md`). See `docs/feat/personal_server.md` for evidence.

- **Project repository/pipeline declarations** live in `<project repo="…"><pipeline>…</pipeline></project>`, parsed by `pipeline_types.ts` and `node/project_catalog.ts`. `node/pipeline.ts` executes generic ci/build/deploy steps; `ci_jazu.ts` is a compatibility shim. State is per project, jobs/logs are shared, and public Git discovery uses generated `projects/git.json`. Private paths and credentials remain operator settings. Do not reintroduce hardcoded Jazu CI steps. Production activation was verified on 2026-11-12 at `8d39520` (157 tests passed and Pages/R2 deployed); real Git provider simulations are in `tests/project_pipeline.test.ts`. The Pi runs master and reuses its existing GitHub SSH key through a Git HTTPS-to-SSH URL rewrite.

- **Docker bootstrap and Git credentials:** `build/` already exists after Git clone because custom compiler sources are tracked. Restore missing compiled inputs by merging without replacing existing files (`ops/docker/entry.ts`, tested in `tests/docker_runtime.test.ts`). Personal mode keeps data under `/data`; bind its `home/` at `/home/node` too, because OpenSSH uses the login home. Public registry infrastructure has separate Terraform state in `terraform/registry/`. Keep original native checkouts/services until container Git, CI and recovery tests pass.

- Split hosts live in the page bundle (`desk_flow`, `desk_preview`, `desk_pdf`). Do not import the kernel/document registry into separately bundled plugin scripts: that creates a second singleton. Use injected host factories. PDF.js is copied from its installed package with local versioned worker/font/CMap/WASM assets and loaded only for PDFs.
- Playwright `setInputFiles`/`fill` can run while an ancestor is inert. Desk tests must wait for `#main-content` to lose `inert` after navigation; otherwise edits/search may be issued before the loading overlay releases focus. The editor's scroll container is `.desk_wbox_body_text`, not its focus-frame wrapper.
- Container CI requires both Python command names: ZIP verification invokes `python`, while the Debian image installs `python3`. `ops/docker/python` provides the alias in full and runtime-patch releases. Final public image `docker-cd8323c` passed the Pi's complete 185-test production pipeline and deployment; keep the stopped previous controller and native installation as rollback options, never concurrent controllers.
