# Project

**JAZU** (JAsouZa User interface) is a file-authored portfolio + browser workspace + technical showcase. The owner writes XML/Markdown/SCSS in `content/`; a TypeScript engine in `engine/` validates it and generates a static, multilingual website (`dist/`); a Cloudflare Worker and an optional personal server add dynamic features. Generation 12 (`package.json` version 0.12.0).

**Read first (in this order):** this file → `README.md` (how to run/deploy) → `docs/README.md` (process, placeholders, limits) → `docs/feat/README.md` (what is done / todo) → the specific guide for the area you touch (`docs/src/*.md` for code, `docs/content/*.md` for content rules).

This file is the fast map for an AI session. **Keep it current:** when you learn something that would have saved time (a trap, a shortcut, where something really lives), add it under "Notes & tips" before finishing. Fix wrong statements instead of appending contradictions.

## Commands

```sh
npm ci                       # install (needs network)
npm run types                # tsc --noEmit over src + tests
npm test                     # node:test contract/unit tests (tests/**/*.test.ts)
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

CLI entry is `node src/main.ts <cmd>` (tsx is registered after a dependency-free `inst` bootstrap). Pipeline steps: `inst test make watch serve host cloud server ext app`; aliases and legacy utility commands remain. App dependencies are installed independently with `npm --prefix app ci`.

Shared contracts live under `shared/`; import them directly rather than restoring compatibility files in `src/` or `server/src/shared/`. Build and listener fingerprints include `shared/`; synthetic engine fixtures and Docker must copy it alongside `src/`. The server compiler emits to `server/dist/server/` and `server/dist/shared/`.

## Repository map

```
config.json            public settings; shared/config.ts loads and validates them
content/               owner-managed XML/Markdown/SCSS; root tag determines interpretation
shared/                content/tags + schema/xml/pipeline/plugin; protocol/wire + codec; work/crypto + profile + drive
                       vnode/vnode.tsx; print/form.tsx; notification/preview + store; sign.ts; http.ts; basic helpers
cloud/
  router/index.ts      Worker entry; Wrangler and deploy use this path
  api/                 auth.ts + auth/{cookies,google}; session.ts; health.ts; work.ts + work/recovery; push.ts; server.ts
  room/                room.ts (Realtime_Hub and route), bus.ts, channels.ts, work.ts
  hub/                 hub.ts (Server_Hub), limits.ts
  repo/                front.ts + fallback.ts (Tunnel-first Git, pinned public-source reads), docker.ts (current public registry Worker)
  security/headers.ts  response headers; shared transport exports
src/                   CLI entry, pipeline.ts, step/ and tools/
engine/                load/, tags/, routes/, style/, seo/, build/, check/
desk/                  browser window/, action/, kernel/, program/, fs/, site/, server/, work/
server/                Node repo/, pipeline/, link/, terminal/, api/ prototype, automation browser/
                       build.cjs emits CommonJS dist/ for Electron; source modules are ESM
extension/             Chromium MV3 extension + native messaging host entries in host/
app/                   independent sandboxed Electron desktop; shared/host owns reusable native framing/PTY code
cloud/infra/           Terraform and wrangler/{local,staging,production}.jsonc
cloud/db/migrations/   D1 SQL; cloud/db/migrate.ts owns migration execution
ops/                   container distribution, service and recovery files
tests/                 node:test *.test.ts at any depth; Playwright *.spec.ts and configs
docs/                  content contracts, implementation guides, feature checklists, infra guides
dist/ .cache/ .wrangler/ generated, ignored
```

## Architecture in one screen

1. `load_site` reads `content/**` + `config.json` → `site_model` (`pages`, `themes`, `objects`, `prints`, `plugins`, `resources`, `icons`, `diag`).
2. Generators expand `<project>/<event>/<blog>` into pages; `build_expertise` computes timeline lanes/slides per language.
3. `compile_plugins`, `compile_inline_layout` (skeleton), `compile_theme` per named theme, `bundle_runtime` (esbuild IIFEs + BusyBox/program WASM → `assets/wasm`).
4. `render_page` (TSX → vnodes) → `to_html` for `index.html`, `serialize` for `index.json` (SPA payload). Page skipped if its hash + outputs match `.cache/hashes.json`.
5. SEO files, icons, covers, `_headers` (CSP hashes), `_redirects`; `write_files` writes only changed bytes and prunes via `dist/.jazu_output.json`.
6. Browser: inline `boot` → skeleton → theme CSS → `page` bundle (SPA, search, desk). Desk = kernel + shared VFS + WASM Workers (`wasm_host.ts`).
7. Cloud: Pages serves `dist`; Worker (`cloud/router/index.ts`) routes subdomains/`/assets` (R2)/`/api` (health, signed git reads, else 501); optional personal node serves signed Git reads over Tunnel+Access.

## Where do I change…

| Task | Files (then docs) |
|---|---|
| Add/rename an XML attribute or tag | `shared/content/schema.ts` → generator (`objects.ts` / `src/web/*`) → `docs/content/{tag}.md` → test in `tests/content/migration.test.ts` |
| Page markup / header | `engine/tags/page.tsx`, `html_head.tsx`; themes in `content/theme/**` target these classes |
| Expertise behaviour | `engine/tags/expertise/model.ts` (model) + `engine/tags/expertise.tsx` (DOM) + `desk/site/expertise.ts`, `search.ts`, `pager.ts` |
| A UI string | `config.json.languages.{en,ja}` (every language) |
| An icon | `node src/main.ts icons add name` → glyph in `content/theme/default/default.xml` |
| Theme look | `content/theme/<name>/*.scss|xml|js`; shared geometry in `content/theme/layout.xml` + `default/default.scss` (scope="layout") |
| Skeleton/loading | `engine/style/skeleton.ts`, `desk/site/loading.ts`, `boot.ts` |
| Desk window bodies | `content/plugins/plugins.xml` (cases) + `desk/window/index.ts` hosts |
| Shell / WASM program | `src/desk/**`, `src/web/client/wasm_*.ts`, `kernel.ts`; docs `src/desk/README.md` |
| Personal server desk (`/server`, Pi agent) | `server/**`, `src/node/server_*.ts`, `src/web/client/{desk_server,desk_server_owner,server_*}.ts`, `content/server.xml`; docs `docs/feat/server.md`; tests `tests/server_*.test.ts` |
| Device shell / extension bridge | `extension/**` (+ `desk/host/host.ts`, `desk_proc.ts`); docs `extension/README.md`, `docs/feat/desk_env.md`; tests `tests/host*.test.ts` |
| Worker route / API | `cloud/router/index.ts` (+ test in `tests/cloud/router/index.test.ts`); keep `{error:{code,message}}` shape and fail closed |
| Infra | `cloud/infra/*.tf`; deploy glue `src/step/cloud_deploy.ts` |
| Fonts | `src/font/*`, `engine/style/font/build.ts`; tests `tests/engine/style/font/binary.test.ts` |

## Conventions that bite

- **XML:** unknown element/attribute = build error. Valueless booleans (`<window full save/>`) are expanded only in start tags. `project` does **not** accept `skill`/`info` (put on `<slide>`); `<action>` is allowed on `project`/`hero`, not `slide`. Keep language variants in the same file.
- **Paths:** relative = from the declaring XML; leading `/` = content root; everything must stay inside `content/` (symlinks resolved). Use `inside()`/`content_file()` for any user-controlled path.
- **Rendering:** no HTML strings in rendering code; build TSX vnodes. `raw()` only for trusted build-time fragments. Browser code should use `to_dom`/`textContent`, not `innerHTML`.
- **Themes never create DOM**; they style fixed DOM, slots (`background_entity_NN`, `foreground_entity_NN`) and the shared canvas. Theme `background` attr: `default` → `background_default.tsx`, anything else → `background_memory.tsx` (hard-coded in `html_page.tsx`).
- **Public slugs keep hyphens** (`galactic-strike`, `web-app`); new internal identifiers are snake_case. Changing a public slug needs a redirect.
- **Privacy:** `/desk` is client-only; nothing client-specific is compiled into static output; `repo` locations and secrets never reach public payloads; print layouts use only the first hero's published data.
- **Fail closed** in the Worker (`501` for unfinished APIs, `404` unknown hosts); personal node requires HMAC-signed GETs.
- **Cache:** `shared_hash` includes the text of every file under `src/`, so any `src/` edit rebuilds all pages (normal). Use `--force` if outputs look stale.
- **Determinism:** pass `--date` when comparing outputs; unchanged pinned-date builds must write 0 files (a test relies on it).
- Generated/ignored: `dist/ .cache/ .wrangler/ .env* *.tfstate terraform.tfvars *.wasm *.tar.* test-results/`.

## Notes & tips (read, and extend)

- **Pipeline desk extensions:** `engine/tags/project/pipeline.ts` copies only explicit menu/window/action UI into public desks, rebasing local split IDs; step commands/arguments/credential declarations stay server-only. `parse_pipeline()` must ignore direct UI subtrees while still rejecting non-step children inside execution steps. Authored inline window `data` is carried as `data-source` and restored through `load_file`; async completion must check the window still belongs to the active desk. Playwright can strip implicit JSX factory imports from engine modules: compile fixture markup in a `node --import tsx` subprocess. On this machine, bound full-suite concurrency with `--test-concurrency=2` to avoid exhausting resources.

- **Blog books (2026-11-23):** Nested blogs keep local IDs in XML; `engine/tags/blog.tsx` derives complete routes and prunes private subtrees. Resource collection must skip nested blog owners, then publish each under its own route. `print="book"` projects public matching-language chapters from generated pages; `engine/build/graph.ts` hashes all chapter sources into the parent book. Only published resources enter print; no live desk state is read. Book markup uses a screen-only hide rule, like research printing.

- **Restored cloud credentials (2026-11-23):** `.env` exists and is ignored; never print or replace its values. `cloud --preflight` is read-only and verifies either account-owned or user-owned tokens. The real account/zone/eight-service checks pass. Deployed routers hold `AUTH_JWT_SECRET` without a local copy; preserve it through inherited bindings or restore its original backup, never generate a replacement. Full bootstrap and interactive Google consent are separate from credential presence. Terraform is at `.cache/tools/terraform/terraform.exe`; staging validate/four mocked tests pass. Optional inherited JWT/agent bindings must remain included even when their input value is null. See `docs/src/cloud-preflight.md`.

- **Hidden windows:** `desk_window.hidden` is separate from minimization and DOM `el.hidden` (which also reflects map/portrait display). `set_window_hidden` preserves drafts/processes. Tab refresh, focus repair, layout and Ctrl+Tab must all respect the flag. The live Windows menu fingerprints before rebuilding, otherwise map/arrange change events form a redraw loop. Reparenting must remove the old parent's `kids` link without orphaning the child's descendants.

- **Version menus:** Public history uses `desk/menu/version.ts` and `shared/repo/history.ts`; only the latest 100 commits are loaded. Branch/tag selections pin hashes. Version maps set `data-map-readonly`, so generic map movement must respect it. API log replies now include parent IDs and refs include peeled tag targets; deploy the matching origin with the runtime. Work/private history and historical file browsing remain open.

- **Research printing:** `engine/tags/print/research.tsx` reads the matching public project's authored research, never the repository/collaborator attributes. The layout CSS is included through the selected print template. Keep the paper hidden with a screen-only layout rule; adding `[hidden]` without a print exemption would trigger the layered hidden-rule trap. The Stesis research example is explicitly placeholder text and must stay labeled as such in print.

- **Desk maps/saving (2026-11-23):** `desk/menu/map.ts` owns map mode; file-tree redraws must preserve `.desk_map` and `.desk_menu_foot`. Plugins use injected `register_map_resources` to avoid duplicated bundle singletons. Save destination cancellation must never clear edits. `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` selects installed Chrome for Windows desk regressions.
- **Window controls (2026-11-23):** Remote browser bodies append asynchronously inside `.server_site`; volume availability needs nested body observation plus `jazu:window-state` for cached viewer changes. Controller cleanup runs through `window_hooks.closed`. Fullscreen decoration rules override skin paint; idle controls stay visible for keyboard focus/open menus. Tests must assert custom audio controls, since the underlying audio element intentionally has no native controls.
- **Browser build freshness:** `serve` builds only when `dist/.jazu_output.json` is absent; it otherwise serves existing output. The desk Playwright server explicitly runs `make serve`. Stop an already-running reused server or rebuild it before testing changed browser code.

- **Root migration (2026-11-22):** runtime code now lives in `engine/`, `desk/`, `cloud/`, `server/` and `shared/`. Follow imports for the exact path; the old `src/web`, `src/node`, `src/desk` and `server/src` locations are gone. Program port sources and manifests live in `desk/program/`; the generic worker dispatches GCC/Python runtime adapters without duplicating worker entries. Wrangler configs are `cloud/infra/wrangler/{local,staging,production}.jsonc`; D1 SQL is `cloud/db/migrations`. Existing local Terraform state/variables moved alongside configs. CLI helpers and handlers now live under `src/tools` and `src/step`. Unit tests are beginning to mirror component paths. Remaining capabilities in COMPONENTS.md use `[ ]` when absent and `[/]` when partially implemented. Reserve `[!]` for explicit human-only blockers; never use `[?]` for absent implementations.

- **Realtime upgrades:** `node/realtime.ts` exports a legacy-compatible Durable Object class (no runtime `cloudflare:workers` import, so Node contract tests can still import the router). Return status 101 directly: rebuilding it in `secure_response` loses its WebSocket. Use hibernation auto-response timestamps for heartbeat leases and alarms, not JS intervals or a D1 write for every ping. Serialize per-socket commands: concurrent watches otherwise overwrite attachments. Version presence snapshots and retain failed fanout in object storage; keep remote fanout outside the projection lock and reschedule alarms using fresh sockets after awaits. New channels belong in `realtime_channels.ts` adapters, not Work-specific branches in the hub. Reconcile presence across all account sockets; a guest replacement closes the old socket.

- **Client fallback keys:** `node/work_unstored.ts` seals client-only recovery bundles in migration 0006's `unstored_keys` using persistent `WORK_FALLBACK_KEY` (Worker secret, independent of D1). Never rotate/regenerate this secret while backups exist. Drive handoff must independently verify the reserved Google file before atomically deleting the row and writing a non-secret completion marker; never delete on the browser's upload claim alone. Guests remain browser-only and the owner remains Drive-only. Fallback mode is server-recoverable, not E2E; old DB backups retain exposure because keys are not rotated.

- **Work presentation:** shared chat geometry belongs in `content/theme/work.scss` (unnamed layout), with theme-specific paint in the named themes. Clients must use `.desk_side_item` entities, not generic lists. Profile images come from verified Google claims or the authenticated matching-subject userinfo backfill, with migration 0005 and a Google-image-host allowlist. Avatar account menus replace the old full-width chat account buttons.
  Chat windows must override the file viewer's `.desk_wbox` overflow on `[data-plugin="messages"]`; only `.desk_messages_log` displays a scrollbar. Keep the textarea's scrollbar hidden even when a long draft reaches its height cap.

- **Opening client windows:** `new_window()` already focuses its result; `activate()` then minimizes it. Use `focus_window()` for client selection (hand off maximization when needed). Open `#head_menu` when revealing Clients so its controls are not covered by the chat window. Browser screenshots after reload must wait for `#main-content` to leave `inert`, otherwise the captured screen can still be the loading skeleton.

- **Guest identity after linking:** `/work/session` must issue a fresh guest cookie after Google sign-out when the previous guest room is bound or closed. Reusing that cookie would prevent a new anonymous room because guest IDs are unique per room. Both SQLite and browser regressions cover linking, signing out, then sending as a new guest.

- **Edge OAuth fetch:** Cloudflare rejects `redirect: "error"` before making a token request. Use `manual` and reject 3xx before reading tokens, so secrets never follow redirects. `tests/cloud/api/auth/runtime.test.ts` exercises bundled auth with real workerd/D1, mocked Google tokens/JWKS and real RSA; Node-only fetch mocks miss this incompatibility. Keep safe `auth_error` codes visible across desk/auth reinitialization.

- **Account controls:** `data-auth="guest|user"` gates header rows; Work uses the same `data-sign="out|delete"` actions. Account deletion uses a CSRF/intent-protected D1 `batch` transaction to revoke all sessions, anonymize/close linked rooms, and remove the profile/admin binding. Preserve shared encrypted history and unrelated clients. Never test deletion against a real user's account; synthetic SQLite/D1 browser fixtures cover confirmation, rollback and tenant isolation.

- **Google authentication:** `node/auth.ts` owns OIDC code/PKCE/nonce and pinned admin sessions (migrations 0003/0004). Google project ownership grants no app role. Sign-in also requests Drive app-data scope; access/refresh credentials are encrypted per opaque session cookie by `google_grant.ts`. The browser receives Drive access in memory only and sends keys directly to Google. Guest linking requires the original guest cookie, verified Google session and CSRF. Browser fixtures use dedicated local D1 state, synthetic HTTPS-source cookies and mocked Drive; actual Google consent remains a user action.

- **Work canonical paths:** Pages redirects `/work` to `/work/`. Use `is_work_path()` in origin forwarding and security wrappers so trailing slashes and `/work/index.json` strip query secrets and retain `no-store`/`no-referrer`, including errors. Keep generated `/work/*` headers equally private. Browser tests must wait for `#main-content` to leave `inert` after boot; otherwise Playwright fill can report success while typing nowhere.

- **Encrypted Work chat:** migration 0004 adds automatic guest-cookie identities, immutable Drive key-file reservations and owner public-key wrapping. `/work` always exposes a composer; no invitation or owner-token login remains. Owner initialization requires real Google Drive app-data consent once. `work_session.ts` manages guest/local, Google/Drive and encrypted client fallback keys; `work_drive.ts` sends keys directly to Google and never overwrites an existing immutable key file. An existing account key prevents guest-history merging. The owner Clients panel opens `im:{email}` / `im:guest/{number}` windows; guest URIs must be recognized in `desk_view.ts`. D1 stores cookie hashes, public/wrapped keys, ciphertext and client recovery bundles sealed by a separate Worker secret. Staging Terraform owns D1/migrations; Pages publication alone cannot update the API.

- **Provider-first clone routing:** Worker `PROJECT_CLONE_ORIGINS` comes from public XML `repo` declarations during Terraform deployment; never put this private routing map into public Pages payloads or forward personal credentials upstream. `git_read_proxy.ts` streams provider reads and redirects failed discovery to the same site's `/_git/pi/` path, pinning subsequent Git requests to Pi. Pushes always use the signed node. Pages CI does not deploy Worker code/bindings; reapply standalone staging Terraform after a routing change. Legacy Workers without the binding retain static clone behavior.

- **Staging infrastructure:** `cloud/infra/staging/` is a standalone root with separate local state; do not apply the production root or import production resources to provision staging. `npm run tf:staging -- plan|apply` bundles the Worker, maps `.env` aliases into child TF_VAR inputs and manages Pages, R2, DNS/domain, Worker routing and secrets. Never generate secret var-files or use Wrangler to overwrite this Terraform-owned Worker. Terraform tests use a mocked provider.

- **Staging pipelines:** multiple `<pipeline>` tags are keyed by unique branch; the first is primary. Use `project_view(config,id,branch)` for branch-specific state/commands and `project_branches()` for polling/authorization. Deployment checkouts are shared and switch only after CI; CI/runtime workspaces are reused, not copied per branch. Never coalesce jobs or deduplicate SHA imports across refs. Secondary branches must not update primary clone mirrors or reuse primary publication state/R2 assets. Engine workers must advertise `branch_pipelines`. The real Jazu staging targets and post-merge instructions are in `docs/infra-staging.md`.

- **Listener upgrades:** `main.ts node` uses the minimal `node/listener_main.ts` entry. Catalogs and pipelines run in fresh `job_main.ts` processes; engine jobs stage their own commit under `<state>/runtime` before parsing XML. Never reintroduce in-process production pipeline/catalog reloads: a cached old schema can reject incoming content. Runtime fingerprints request exit 75 only between jobs; systemd must restart failures. The `isolated:false` runner option and injected `steps` path exist for synthetic integration fixtures only. Regressions are in `tests/server/pipeline/job_process.test.ts`.

- **A fresh checkout from `codebase.zip` cannot build** until the ignored WASM artifacts exist: `src/desk/busybox/artifacts/busybox.wasm` + `busybox-source.tar.bz2`, `src/desk/programs/artifacts/{fastfetch,htop,tcc}.wasm` + `*-source.tar.*` + `ncurses-source.tar.gz`. `bundle_runtime()` reads them unconditionally (ENOENT otherwise). `npm run pack` drops them because `.gitignore` ignores `*.wasm`/`*.tar.*` even when git tracks them. `tests/desk/kernel/worker.test.ts` needs them too.
- **Cloud sessions:** network and `npm ci` may be unavailable; without `node_modules` you cannot run tsc/tests/build. Say so honestly instead of claiming verification. Docs-only changes need no build.
- **Print = blank page trap:** resume/rirekisho markup is emitted `hidden`. The inlined skeleton is `@layer skeleton, layout; @layer layout{…}` and a layered `!important` beats ANY unlayered `!important`, so print CSS can never override `[hidden] { display: none !important }`. `content/theme/layout.xml` therefore exempts `.landing_resume`/`.expertise_resume` from it and hides them in `@media screen` only. Don't add other `!important` layout rules that print needs to beat (see `tests/engine/style/print.test.ts`).
- **Device bridge:** `extension/` is plain JS/TS run directly (no build step; host needs Node ≥ 22.18 type stripping, so only erasable TS syntax: no enums/namespaces). The extension id is fixed by the `key` in `extension/manifest.json`; `extension/host/install.ts` derives it, so never change the key without reinstalling. `tests/desk/host/host.test.ts` runs the real `content.js`/`background.js`/`desk_host.ts` in `vm` against the real host (no browser available in cloud sessions). Branded Chrome ≥ 137 ignores `--load-extension`; kiosk docs assume Chromium.
- **Legacy residue:** `schema.ts` still accepts `landing`, `contact`, `error`, `resume` tags and `seo_text.tsx` handles them; no content uses them (migration to `hero`/`item` is done). Safe to remove when touching those files.
- **Stale comments:** some file headers mention `client_*.ts` names, `jazu.config.ts`, `<resume format=…>`, `home_jason` — gen-11 names. Trust the code, fix the comment when you are there.
- `README`/docs once claimed "22 regression tests / 68 routes"; the suite has grown. Re-measure before quoting numbers.
- `COMPONENTS.md` is the current owner contract. Preserve descriptions and human decisions; update statuses with evidence. Use `[ ]` for unimplemented features, `[/]` for incomplete implementations, `[!]` only for human-only blockers, and `[?]` for review-ready implementations; see `docs/feat/implementation-audit.md`. `TASKS.md` and `PLACEHOLDER.md` remain absent; legacy feature guides and placeholders are under `docs/`.
- `gen-11/` is mentioned in old docs as an ignored reference checkout; never import from it (not in this repo).
- `.cache/hashes.json` is a flat hash map, not the timestamp/manifest/`HEAD` design the docs describe as the target.
- `schema.ts` `event` rule is defined twice (the second via `Object.assign` wins).
- Existing code style does not fully follow the "block comment at top of each file" rule below; apply it to files you create or substantially rewrite, don't mass-edit.

- **Personal server git/CI:** projects with XML repo/pipeline declarations are active; other legacy entries remain archived (`is_active`). New `src/node/*` files avoid enums/parameter properties so plain `node` (type stripping) can run them, which the generated git hooks and `tests/server/repo/git/http.test.ts` rely on (`node --test tests/server/repo/git/http.test.ts`; uses real git, needs no npm install). In tests, git clients that talk to in-process servers must be async (`execFileSync` deadlocks the event loop).
- `ci_jazu.ts` is meant as the template for other projects' pipelines; its steps are data (`jazu_steps`). CI/CD children get a scrubbed env on purpose; test doubles must signal through files, not env vars.
- `content/projects.xml` has a placeholder `<project id="jazu">` (needed so the Worker's `PUBLIC_PROJECTS` includes it and `/projects/jazu` exists). It was added without a build; run `npm run check` and rewrite the text.

- **PWA/Web Push:** `engine/routes/sw.js.ts` emits `service-worker.js` + `offline.json` from the finished output map (allowlist = public files only). Pages serves `/x/index.html` as `/x/` via 308, so the worker installs from canonical URLs and verifies SHA-256 revisions (never `redirect: "error"`). Push payloads carry routing metadata only; the device fetches ciphertext from `/api/_/push/message` and decrypts with a non-extractable key kept in IndexedDB (`notification_store.ts`). Never regenerate `VAPID_*` while subscriptions exist (`npm run push:keys` refuses). The PWA feature was finished without `node_modules`: run `npm run types && npm test && npm run test:pwa:browser` first. Details: `docs/feat/pwa.md`.

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

- **Current WASM inputs** live in ignored `build/<package>/`, including `build/busybox/busybox.wasm`, not the older `src/desk/*/artifacts` locations described above. CI restores `build/` and `content/media/` from `site.dir`. Production uses `cloud/infra/wrangler/production.jsonc`; import its resources before running Terraform. The hub deploy branch can differ from the working branch using `site.checkout_branch`.

- **Production Git history contains large videos.** `git repack --max-pack-size=20m` can still emit oversized packs for indivisible blobs. `publish.ts` uploads these packs (and oversized site assets) to R2 before Pages; the Worker serves pack ranges from R2. CI on the ARM Pi needs the 10-minute WASM test timeout. Production clone and push were verified; the later Docker service cutover was verified with the original checkout retained (see `docs/feat/docker.md`). See `docs/feat/personal_server.md` for evidence.

- **Project repository/pipeline declarations** live in `<project repo="…"><pipeline>…</pipeline></project>`, parsed by `pipeline_types.ts` and `node/project_catalog.ts`. `node/pipeline.ts` executes generic ci/build/deploy steps; `ci_jazu.ts` is a compatibility shim. State is per project, jobs/logs are shared, and public Git discovery uses generated `projects/git.json`. Private paths and credentials remain operator settings. Do not reintroduce hardcoded Jazu CI steps. Production activation was verified on 2026-11-12 at `8d39520` (157 tests passed and Pages/R2 deployed); real Git provider simulations are in `tests/server/pipeline/pipeline.test.ts`. The Pi runs master and reuses its existing GitHub SSH key through a Git HTTPS-to-SSH URL rewrite.

- **Docker bootstrap and Git credentials:** `build/` already exists after Git clone because custom compiler sources are tracked. Restore missing compiled inputs by merging without replacing existing files (`ops/docker/entry.ts`, tested in `tests/server/container.test.ts`). Personal mode keeps data under `/data`; bind its `home/` at `/home/node` too, because OpenSSH uses the login home. Public registry infrastructure has separate Terraform state in `cloud/infra/registry/`. Keep original native checkouts/services until container Git, CI and recovery tests pass.

- Split hosts live in the page bundle (`desk_flow`, `desk_preview`, `desk_pdf`). Do not import the kernel/document registry into separately bundled plugin scripts: that creates a second singleton. Use injected host factories. PDF.js is copied from its installed package with local versioned worker/font/CMap/WASM assets and loaded only for PDFs.
- Playwright `setInputFiles`/`fill` can run while an ancestor is inert. Desk tests must wait for `#main-content` to lose `inert` after navigation; otherwise edits/search may be issued before the loading overlay releases focus. The editor's scroll container is `.desk_wbox_body_text`, not its focus-frame wrapper.
- Container CI requires both Python command names: ZIP verification invokes `python`, while the Debian image installs `python3`. `ops/docker/python` provides the alias in full and runtime-patch releases. Final public image `docker-cd8323c` passed the Pi's complete 185-test production pipeline and deployment; keep the stopped previous controller and native installation as rollback options, never concurrent controllers.

Component alignment verification (2026-11-22, Windows): the main suite has four pre-existing failures in `tests/desk/server/fs.test.ts`, and the agent suite has seven in `server/test/{agent,fs_channel}.test.ts` because native Windows temp paths violate the Pi channel's POSIX-only absolute-path contract. Both were reproduced with original revision files; do not treat these as shared/cloud migration regressions or silently skip them. Google sign-in Playwright verification passed against local Wrangler/D1. Before deploying the new API paths, register `/api/_/auth/google/callback` with Google and deploy the site, Worker and agent together.

- **Desktop/host validation (2026-11-22):** `app/` is independent of `server/`; reusable native framing/protocol/PTY code is `shared/host/`. Compiled Python and script PTYs passed on the ARM64 server. Its host Node is v20, so source TypeScript needs Node >=22.18 or the compiled host. Electron launch must remove `ELECTRON_RUN_AS_NODE` from its child environment entirely; even an empty value enables Node mode. Root/app typechecks and the real Electron smoke pass. Two final Electron launch retries timed out before debugger attachment; app acceptance remains an issue. The installed Chrome channel works for desk regressions; the bundled headless shell stalled in this environment.
