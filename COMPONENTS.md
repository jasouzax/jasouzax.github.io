# JAZU Components Development Document
**JAZU** *(JAsouZa User interface)* is a website system, while `Components Development Document` (CDD) acts as a central document used by human like the owner, to align their interest with AI agents or developers and componentize the whole codebase, AI agents shouldnt change the details or description as they can only suggest changes or update checkboxes. So a complex system is broken down to a set of components interacting with each other, all assigned an URI so that referencing each other is easier like `obj:/...` to identify objectives, and `cmp:/...` to identify components. Resources can be identified through URI too like `{root}/path/to/resource`, it can be for the codebase `{codebase}`, or the domain website `{website}` which in this case is `jasouza.com`, and the owner `{owner}` which in this case is `jason@jasouza.com`, and `{vfs}` which represents the desk's virtual filesystem. Note that every Blockquotes `>` are to be removed in the final `COMPONENTS.md` because they currently act as notes of changes to be done from the original goal or current codebase status. Note that checkboxes are represented by `[ ]` meaning not yet implemented, `[/]` is incomplete but currently working on it, `[!]` priorty issue the human must check, `[?]` completed feature that the human must check and accept, `[x]` the human as marked the feature/component complete (AI Agents should never place this mark), `[*]` the feature exists in the code but must be refactored (or renamed/moved/removed) to align with the new vision, the blockquote under it says what to change. Note that blockquotes acts like comments to indicate messages from human to AI or AI to human.

> **Implementation pass (AI, 2026-11-22):** eight feature branches plus one runtime-fix branch implement dependency/extension steps, fixed desks, RSS/Atom, cloud preflight, JWT refresh sessions, pipeline hooks, print styles/fonts and the independent Electron desktop. All remaining unfinished items are `[!]` with a concrete gap; `[?]` means implemented and awaiting human acceptance, never a claim that missing systems shipped. The detailed evidence and remaining-work inventory are in `docs/feat/implementation-audit.md`. Historical notes below are preserved; this dated audit supersedes their implementation-status claims. No live service, DNS, Terraform state or image was replaced.

> **Final alignment review (AI, 2026-11-22):** all component `[*]` entries have been audited. Existing refactors are `[?]`; missing capabilities are `[ ]`; mixed components remain `[/]` with their missing portions explained. The dated Alignment review notes below supersede older refactor notes and historical evidence. No `[x]` was assigned. This is code alignment, not production deployment or acceptance of absent capabilities.

> **Final validation (AI, 2026-11-22):** types, content check (71 pages, 39 warnings), static build and server build pass. The main suite has 293 passes, 4 skips and the same 4 pre-existing Windows/POSIX filesystem failures; the server suite has 65 passes, 1 skip and the same 7 previously reproduced Windows path failures. All 22 final focused checks and 9 browser regressions pass. Host emulation was exercised with local D1/Worker/API/static assets on one public port. Terraform is unavailable locally, so the new repository-host plan has not been validated/applied by Terraform. No live server, DNS, cloud state or published images were changed.

> **Continuation scope (human clarification, 2026-11-22):** missing capabilities are marked `[ ]`; existing features are refactored and marked `[?]` after verification. Blog scenes/Canvas rendering, the JWT/refresh hybrid and account/token/scope deployment preflight are absent capabilities, so their former `[*]` marks are now `[ ]`. Existing Markdown blog pages and opaque-session authentication remain available.

> **Layout continuation (AI, 2026-11-22):** engine, desk and personal-server code now live in their roots. `src/` contains CLI configuration, pipeline composition, steps and tools. Fixed step selectors, aliases, ranges and implemented-step `all` are available; install/extension/app steps remain absent. Native watches cover engine, desk, shared and content. The existing per-program workers were consolidated into one worker; GCC/Clang and Python retain their specialized runtime adapters under their program folders. Program manifests own versions, commands and WASM hashes. Build sources moved to `desk/program`, infrastructure to `cloud/infra`, Wrangler configurations to `cloud/infra/wrangler`, and D1 migrations to `cloud/db/migrations`. Local Terraform files were preserved, not recreated. Standalone root boundaries pass; 44 WASM regressions, three real browser desk tests and 19 build/cache/listener checks pass. Remaining behavior refactors are still tracked below.

> **Verification (AI, 2026-11-22):** `npm run types`, the server build, content check (71 pages, 39 existing warnings), static build (71 pages; existing server:fastfetch resource warnings) and the Google sign-in Playwright check pass. The final main suite has 282 passes, 4 skips and 4 failures, all in Windows-incompatible server filesystem tests reproduced from the original revision. The separate agent suite has 65 passes, 1 skip and 7 filesystem failures also reproduced from the original revision. All 30 focused content/build/listener tests and the focused cloud/edge checks pass. This is an incremental alignment pass, not acceptance of the unfinished objectives.

> **Cloud alignment (AI, 2026-11-22):** the Worker runtime now lives in `cloud/router`, `cloud/api`, `cloud/room`, `cloud/hub`, `cloud/repo` and `cloud/security`. Fixed APIs use `/api/_/{id}`; session discovery is `/api/_/session`. Browser, agent, service worker, fixtures, docs and Wrangler/deploy entry points follow the new paths. Register `/api/_/auth/google/callback` with Google before deployment. No legacy URL aliases were added. JWT sessions, the repository-host cutover, gateway replacement, infrastructure/migration folder moves and the remaining router splits are still open; cloud stays `[/]`. The unused WORK_OWNER_TOKEN example and staging fixture were deleted.

> **Content alignment (AI, 2026-11-22):** vocabulary now lives in `shared/content/tags/{tag}.ts`. Skills have no info/stack or children; stacks have only id/name. Slides use `info` and `featured_stack`, with privacy on the project; research uses `<similar>`. Authored XML, rendering and docs follow these names. Legacy landing/contact/error/resume tags are rejected; SEO text reads hero/items. Event resume_start/resume_end were removed in favor of date-based history wording; `resume` remains for license classification. The broader page/project/event vocabulary cleanup, hero/print redesign and engine tag moves remain open.

> **Alignment pass (AI, 2026-11-22):** shared contracts now live under `shared/` (protocol, content/schema, pipeline/plugin shapes, work crypto/profile/Drive format, vnodes, print form, notifications, config and basic helpers). Existing consumers import them directly. Build and listener fingerprints include shared sources; cleanup protects all planned roots. The full engine/desk/cloud/server split remains unfinished; per-tag schemas were extracted in the follow-up below. The import boundary check passes for existing roots; shared stays `[/]` while the full consumer/root migration remains incomplete.

> **Status review (AI, 2026-11-22):** every mark below was set from the code in the uploaded `codebase.zip` and `docs/feat/*`, not from memory. `[?]` means code exists and the docs/tests claim it works, so the human must still accept it. Marks on small leaf items are inherited from their parent unless a blockquote says otherwise, verify them when you work on that component. Nothing was run, no test or build was executed.
> **Decisions recorded (human, 2026-11-22):** full folder split (`engine/ cloud/ server/ desk/ app/` + thin `src/`); `server/` is only the Node service (repository hub, project pipelines, custom APIs, automation browser) and `app/` is a separate Electron desktop that does nothing with the server; git lives at `repo.jasouza.com/{id}` over the Tunnel (replaces `registry.jasouza.com`); icon tokens `[token]` stay but PUA codes become Material Design Icons; work subdomain is exactly `{work id}.jasouza.com` and project/work IDs never collide; fixed APIs are `/api/_/{id}`, custom APIs `/api/{id}/v{n}`, id `_` reserved; blog video uses a deterministic Canvas renderer. Second round: sessions are a short-lived JWT plus an opaque hashed refresh token in D1 (sensitive actions also check D1); WebAuthn is an optional user setting for big actions (owner login, account deletion), CSRF stays everywhere; SSE is for custom APIs only; ID rules and reserved names below; `{codebase}/shared` exists; `.env` has a required manual set checked before the cloud step; `WORK_OWNER_TOKEN` is deleted. Third round: custom APIs run as one child process per script, in the same OS user and environment as `node src/main.ts server` (docker confines them to the container); servers take roles (`server:repo`, `server:ppl`, ...), unify under `{vfs}/srv`, and each server's own filesystem is `{vfs}/net/{id}`; tokens, rate limits, access and response checks are enforced by the server from the API config; the schema of each tag lives in `shared/content/tags/{tag}.ts`; `personal-server` stays the tunnel hostname. Fourth round: roles `repo`, `pipeline`, `browser`, `api` overlay and `ppl` (personal details) is exclusive, more exclusive roles may be added; role `repo` overlays `{vfs}/srv/projects` (working trees and build outputs such as docker, deb, dnf) and `{vfs}/home/{client username}` (client codebases stay on the personal server for privacy and confidentiality), `{vfs}/srv/repo` is not used; every server's tunnel hostname is `{id}-server.jasouza.com`.

## Codebase Layout
**Rule 1, the path is the component:** `cmp:/{root}/{a}/{b}` lives at `{codebase}/{root}/{a}/{b}.ts` (or `.tsx` when it produces markup). If you know the component you know the file, if you know the file you know the component.
**Rule 2, start from what you see:** from `{codebase}/content` you look for the tag name (`engine/tags/{tag}.tsx`), from `{codebase}/dist` you look for the output path (`engine/routes/{path}.tsx`), from the running desktop you look for the window, action or menu name (`desk/window|action|menu/{name}.ts`), from an API URL you look for the id (`cloud/api/{id}.ts` for `/api/_/{id}`, the server's `api/` for `/api/{id}`).
**Rule 3, splitting:** a file keeps one concern. When it grows, it stays the entry and its parts move to a sibling folder of the same name (`engine/tags/expertise.tsx` + `engine/tags/expertise/{timeline,slides,chips}.ts`). Code shared by several components goes in a folder named after what it produces or does (`engine/style/`, `engine/seo/`), never `util`, `misc` or `common`. Code shared by two or more roots goes in `{codebase}/shared`.
**Rule 4, tests and docs mirror the code:** `tests/{root}/{same path}.test.ts`, and the docs of a tag are `docs/content/{tag}.md`.
**Rule 5, imports:** `engine`, `desk`, `cloud`, `server`, `app` and `extension` may import only `shared/` and themselves. `src/` (the CLI) may import any root. `tests/layout.test.ts` fails on any other import.
**Rule 6, where things live, one owner each:** authored content `content/`; public settings `config.json`; secrets `.env`; build output `dist/`; build cache `.cache/`; cloud state in D1 (relational), KV (small registries, cached about 60 s), R2 (large objects) and Durable Objects (hub, live rooms); server state in the server's data directory (the SQLite next to each `*.auto.js`, autostart list, logs, repositories); browser state in `{vfs}/home/user` (OPFS) and `/tmp` (memory only). Every datum has exactly one owning component and everyone else goes through that component, for example only `cloud/api/clients.ts` touches the clients table and only `server/api/store.ts` touches an API's SQLite.
- [?] `{codebase}/src` `cmp:/src` - thin CLI only.
- [?] `{codebase}/engine` `cmp:/engine` - content to static website.
    > **Alignment review (AI, 2026-11-22):** Existing engine moved to load/tags/style/seo/build/check/routes. Tag components own hero/item/menu/entry/map/action/foot/window/project/event rendering; build writing and bundling have separate owners. Resource reads used by renderers go through load adapters. Additional generated-route families remain a separate unimplemented item below.
- [?] `{codebase}/desk` `cmp:/desk` - browser runtime of the desktop and WASM programs.
    > **Alignment review (AI, 2026-11-22):** Browser code lives under desk. One worker entry runs every WASM program, with specialized GCC/Python adapters and per-program manifests. Existing text/hex and PDF/media behaviors now share their intended component owners.
- [!] `{codebase}/cloud` `cmp:/cloud` - Cloudflare: Worker, Durable Objects, D1, Terraform.
    > **Implementation audit (AI, 2026-11-22):** Cloud modules exist, but multi-server registration, versioned gateway, clean-account Tunnel/Access setup and remote state remain incomplete.
- [?] `{codebase}/server` `cmp:/server` - personal server (Node service + automation browser).
    > **Alignment review (AI, 2026-11-22):** Node repository, pipelines, link and automation browser now live under server; Electron remains the automation-browser runtime. Multi-server roles and a separate desktop App are absent capabilities, tracked independently.
- [!] `{codebase}/app` `cmp:/app` - Electron desktop environment, independent of the server.
    > **Final verification (AI, 2026-11-22):** The package builds and an initial real Electron smoke passed, but repeated final launches timed out before the debugger attached. Launch reliability and full native integration remain unresolved.
- [!] `{codebase}/extension` `cmp:/extension` - Chromium extension and native host.
    > **Implementation audit (AI, 2026-11-22):** Native shell bridge and packaging work; external-site embedding, cookie policy and real Chromium kiosk acceptance are incomplete.
- [?] `{codebase}/shared` `cmp:/shared` - code used by two or more roots. Every root may import `shared/`, roots never import each other (enforced by `tests/layout.test.ts`, which scans imports).
    > **Implementation audit (AI, 2026-11-22):** Shared contracts and native-host runtime have real consumers in multiple roots; the root import-boundary regression passes.
- [?] `{codebase}/content`, `{codebase}/config.json`, `{codebase}/.env`, `{codebase}/tests`, `{codebase}/docs`, `{codebase}/ops` (Docker, service files), `{codebase}/dist` (generated).
    > **Alignment review (AI, 2026-11-22):** Content/configuration remain at their owning roots; Terraform/Wrangler/D1 inputs moved under cloud. Unit tests mirror component paths and documentation references follow the moved modules. Generated outputs/cache remain ignored.
    > Decided: `shared/` exists. Evidence (imports counted under this layout): the wire protocol is used by desk (16 imports), the cloud hub and the server; `pipeline_types` by engine, cloud and server; HMAC signing by cloud and server; `work_crypto`, `work_profile` and the Drive key-file format by cloud and desk; `plugin_types`, `vnode`, `mime`, `era`, `rireki_form` and `notification_*` by engine and desk; `util`, `diag`, `paths`, `config` by engine (40 imports), cloud and server.
    > `git_read_proxy.ts` is Worker-side code (it imports `worker.ts`), it moves to `cloud/repo/`, not to `server/`.

### `{codebase}/engine`
```
engine/
  tags/       content -> markup. One file per XML tag, file name = tag name, exporting its generator. The schema of the same tag (allowed attributes, children, required, booleans) is `shared/content/tags/{tag}.ts`, same name, so the server and the cloud can validate without importing the engine. Cross-tag validation (unique IDs, reserved names, pipeline branches) is `engine/tags/_.ts`, where `_` means all tags.
    page.tsx hero.tsx item.tsx action.tsx expertise.tsx skill.tsx stack.tsx desk.tsx menu.tsx entry.tsx foot.tsx map.tsx node.tsx edge.tsx
    window.tsx style.tsx project.tsx slide.tsx research.tsx pipeline.tsx step.tsx event.tsx blog.tsx scene.tsx theme.tsx font.tsx print.tsx plugin.tsx case.tsx
    expertise/  parts split from one tag: model.ts (timeline, lanes), slides.ts, chips.ts
    page/       head.tsx (header and tabs), shell.tsx
    theme/      background_default.tsx, background_memory.tsx
    window/     one file per built-in window body (video.tsx, svg_edit.tsx)
    print/      rirekisho.tsx, form.tsx
  routes/     dist -> code. Mirrors dist/ exactly, one generator per output file or output family.
    robots.txt.tsx  sitemap.xml.tsx  llms.txt.tsx  llms-full.txt.tsx  manifest.webmanifest.tsx  _headers.tsx  _redirects.tsx  sw.js.ts
    [path]/index.html.tsx  [path]/index.json.tsx          every page (calls tags/page.tsx)
    [lang]/sitemap/index.html.tsx
    assets/theme/[name].css.ts  assets/fonts/[name].woff2.ts  assets/runtime/[name].js.ts  assets/wasm/[name].wasm.ts
    covers/[path].png.tsx  icons/[name].png.ts
  style/      everything that makes CSS or fonts (also used by tags/theme, tags/print): skeleton.ts, theme.ts (SCSS to scoped CSS), layout.ts, print.ts, icons.ts ([token] to Material Design codepoint), font/{build,binary,outlines}.ts
  seo/        head tags and files: head.tsx, jsonld.ts, og.ts, cover.tsx, sitemap.ts, robots.ts, llms.ts, rss.ts
  load/       reading the site: scan.ts, model.ts, resources.ts   (xml, schema and config are in shared/content and shared/config.ts)
  build/      incremental pipeline: build.ts, graph.ts, cache.ts, write.ts, bundle.ts (esbuild of desk/), watch.ts
  check/      content validation: check.ts, diag.ts, tiers.ts
  helper/     small pure helpers named by role: dates.ts, slug.ts, gitignore.ts, raster.ts   (mime, era, diag, util, paths, config are in shared/)
```
- Examples: change how `<hero>` renders -> `engine/tags/hero.tsx`. Add attribute `fixed` to `<desk>` -> its schema `shared/content/tags/desk.ts` and its rendering `engine/tags/desk.tsx`, then `docs/content/desk.md` and `tests/engine/tags/desk.test.ts`. `dist/robots.txt` is wrong -> `engine/routes/robots.txt.tsx`. `dist/assets/theme/default.css` is wrong -> `engine/routes/assets/theme/[name].css.ts`, which calls `engine/style/theme.ts`. A JSON-LD field is wrong -> `engine/seo/jsonld.ts`. Build says "unknown attribute" -> the schema in `shared/content/tags/{tag}.ts`; a cross-tag rule fails -> `engine/tags/_.ts`. A new icon token -> `engine/style/icons.ts`.
    > Today's `src/web/html_page.tsx`, `html_head.tsx`, `html_sections.tsx`, `html_expertise.tsx`, `html_desk.tsx`, `html_rirekisho.tsx`, `rireki_form.tsx`, `partials/*`, `seo*.tsx`, `skeleton_css.ts`, `vnode.tsx`, `src/{model,objects,schema,xml,expertise,theme_css,layout_css,font_build,font,plugins,graph,cache,check,...}.ts` all map into the folders above. `objects.ts` (project/event/blog expansion) splits into `tags/{project,event,blog}.tsx`. `vnode.tsx` goes to `shared/vnode/` because the browser uses `to_dom`.

### `{codebase}/desk`
```
desk/
  window/     cmp:/desk/window/*  media.ts text.ts shell.ts note.ts folder.ts page.ts autosite.ts autojs.ts messages.ts   (media/ browse.ts timeline.ts tools.ts)
  action/     cmp:/desk/action/*  icon.ts history.ts resource.ts volume.ts chat.ts save.ts fullscreen.ts split.ts move.ts
  menu/       cmp:/desk/menu/*    file.ts chat.ts over.ts windows.ts version.ts people.ts   + foot.ts map.ts (shared by every menu)
  fs/         cmp:/desk/fs/*      static.ts uploads.ts shared.ts personal.ts public.ts collab.ts   + vfs.ts (the single {vfs} entry), opfs.ts
  pin.ts      cmp:/desk/pin
  kernel/     process.ts, syscalls.ts, procfs.ts, wasm_host.ts, wasm_protocol.ts, worker.ts (the ONE generic WASM worker)
  program/    one folder per executable: busybox/ gcc/ fastfetch/ htop/ ffmpeg/ ...   each: program.json (name, files, sha256, flags), build.sh, port notes
  plugin/     loader.ts (reads cmp:/content/plugin), flow.ts (convert/compare/mirror graph)
  mime/       detect.ts
  server/     the client side of cmp:/server, one file per channel: link.ts fs.ts pty.ts script.ts site.ts sessions.ts audio.ts input.ts windows.ts touch.ts
  work/       cmp:/work client: realtime.ts, sign.ts, messages.ts, users.ts
  host/       bridge to cmp:/extension and cmp:/app: host.ts, proc.ts
  site/       page runtime that is not a window: boot.ts spa.ts loading.ts pager.ts scroll.ts search.ts theme_switch.ts print.ts pwa.ts notifications.ts expertise.ts menus.ts rireki_editor.ts
```
- Examples: add a new executable (say `jq`) -> `desk/program/jq/` (`program.json`, `build.sh`), declare it in `content/plugins/plugins.xml`; no new worker file. Change how images open -> `desk/window/media.ts`. Change what the Save button does -> `desk/action/save.ts`. The Files menu shows wrong entries -> `desk/menu/file.ts`. `/home/user` storage bug -> `desk/fs/shared.ts`. A `/server` terminal problem -> `desk/server/pty.ts` (client) or `server/terminal/pty.ts` (service).
    > Today these are the 142 flat files of `src/web/client` (`desk_*` 33, `wasm_*` 70, `server_*` 14, `work`, `realtime`, `spa`, ...), the 66 `wasm_worker_{program}.ts` files (about 600 bytes each, identical but for the program name) become `program/{name}/program.json`, and `build/` plus `src/desk` toolchains move into `program/`.

### `{codebase}/cloud`
```
cloud/
  router/     index.ts (Worker entry), host.ts (subdomain -> project redirect | demo | work | 404), assets.ts, api.ts (/api dispatch)
  api/        system APIs, file name = API id. /api/_/{id} -> api/{id}.ts   auth.ts session.ts clients.ts work.ts push.ts realtime.ts server.ts health.ts
  hub/        the Server_Hub Durable Object (personal server link): hub.ts limits.ts route.ts
  room/       the per-client Durable Object: room.ts bus.ts channels.ts work.ts
  gateway/    custom APIs /api/{id}: manifest.ts match.ts auth.ts validate.ts rate.ts sign.ts
  repo/       repo.jasouza.com thin front: front.ts (tunnel first, fallback second), fallback.ts (typed sources from KV)
  security/   csrf.ts headers.ts cors.ts   (HMAC signing is shared/sign.ts)
  db/         migrations/0001_work.sql ...   migrate.ts
  infra/      pages.tf worker.tf r2.tf kv.tf d1.tf dns.tf access.tf tunnel.tf  staging/  deploy.ts publish.ts  wrangler/{production,staging,local}.jsonc
```
- Examples: `/api/_/push` misbehaves -> `cloud/api/push.ts`. Subdomain `acme.jasouza.com` goes to the wrong place -> `cloud/router/host.ts`. A new D1 table -> `cloud/db/migrations/`. A missing DNS record or KV namespace -> the matching `cloud/infra/{resource}.tf`.

### `{codebase}/server`
```
server/
  main.ts     entry (builds the parts below and dials the Worker)
  link/       cmp:/server/link       hub.ts ws.ts sign.ts
  repo/       cmp:/server/repo       index.ts (host router) auth.ts (tokens, roles)   git/{http,hooks,mirror,read}.ts   docker/   linux/{apt,dnf}.ts   lib/{npm,pypi,deno,go}.ts
  pipeline/   cmp:/server/pipeline   catalog.ts queue.ts runner.ts process.ts sync.ts   trigger/{branch,hook}.ts
  api/        cmp:/server/api        sdk.ts store.ts manifest.ts deploy.ts secrets.ts   route/{rest,job,stream,socket,hook}.ts   pubsub.ts
  browser/    cmp:/server/browser    sites.ts windows.ts input.ts audio.ts clipboard.ts selector.ts runner.ts autostart.ts assets/
  terminal/   cmp:/server/terminal   pty.ts pty_channel.ts fs_channel.ts fastfetch.ts
  config/     config.ts env.ts repositories.ts
```
- Examples: a push is rejected -> `server/repo/git/hooks.ts`. A pipeline step does not start -> `server/pipeline/runner.ts`. A custom API SSE route -> `server/api/route/stream.ts`. A selector picks a fragile element -> `server/browser/selector.ts`.
    > Today `server/src/` already is the automation-browser agent (`web.ts`, `windows.ts`, `sites.ts`, `selector.ts`, `runner.ts`, `api.ts` prototype, `agent.ts` switchboard); the Node-only hub code is in `src/node/{server_*,git_*,pipeline*,queue,runner,repo_sync,project_catalog,listener_main,personal,job_*,hook_main}.ts`. Both merge into this tree.

### `{codebase}/app`
```
app/
  main.ts     Electron entry (a frameless/kiosk window showing {website} or localhost)
  wm/         one file per window manager backend: x11.ts i3.ts sway.ts hyprland.ts
  host/       ipc.ts   (same protocol as extension/host, from shared/)
  io/         pty.ts fs.ts input.ts audio.ts clipboard.ts
```
- Examples: windows are placed wrongly on Sway -> `app/wm/sway.ts`. Terminal inside the desktop -> `app/io/pty.ts`.

### `{codebase}/shared`
```
shared/
  protocol/   wire.ts codec.ts        wire protocol between page, Server_Hub and agent (today server/src/shared/{protocol,codec}.ts)
  sign.ts                             HMAC sign/verify for cloud <-> server (today node/security.ts and server/src/sign.ts)
  work/       crypto.ts profile.ts drive.ts      Work chat crypto, profile, Drive key-file format
  content/    tags/{tag}.ts (schema of each tag, same names as engine/tags), schema.ts (aggregates tags/*), ids.ts (ID rules and reserved names), pipeline.ts, plugin.ts, xml.ts
  vnode/      vnode.tsx to_html.ts to_dom.ts      the same JSX factory builds HTML at build time and DOM in the browser
  notification/ preview.ts store.ts               service worker and desk
  mime.ts era.ts diag.ts util.ts paths.ts config.ts
```
- Examples: a wire-protocol field changes -> `shared/protocol/wire.ts` (desk, cloud and server all follow). The HMAC header changes -> `shared/sign.ts`. `<pipeline>` parsing changes -> `shared/content/pipeline.ts`.
    > Decided: `project_catalog.ts` validates through `shared/content/schema.ts`. A tag's vocabulary lives in `shared/content/tags/{tag}.ts`, what it becomes lives in `engine/tags/{tag}.tsx`, and the build-time check across all tags is `engine/tags/_.ts`. The same split applies elsewhere: a shape used by two roots is declared once in `shared/`, behaviour stays in its root.


### `{codebase}/src`, `{codebase}/extension`, tests
```
src/        main.ts  pipeline.ts (parses "test:content make-host")  step/{inst,test,make,watch,serve,host,cloud,server,ext,app}.ts  tools/{icons,graph,pack,clean}.ts  config.ts
extension/  manifest.json background.js content.js   host/{protocol,frame,pty,install}.ts
tests/      engine/tags/hero.test.ts  engine/routes/robots.test.ts  desk/window/media.spec.ts  cloud/api/auth.test.ts  server/repo/git/http.test.ts  content/check.test.ts
```
- Pipeline step name = file name: `node src/main.ts make` runs `src/step/make.ts`.

## Problems/Objectives
- [!] **Portfolio** `obj:/port` - a central place where recruiters and the public can browse the owner's work and contact/collaborate with the owner.
    > **Implementation audit (AI, 2026-11-22):** Portfolio browsing works; the interactive scene-blog and owner editing objectives remain incomplete.
    - [!] **Blogging** `obj:/port/blog` - I can express ideas/lessons/discussion as blogs publically. This blogs are visual/audio interactive media following the blog script (note the blog script is also considered a content), meaning I can compile it ahead of them and post them in social media like youtube, or shorts.
        > **Implementation audit (AI, 2026-11-22):** Markdown blogs and feeds exist; scene authoring, deterministic Canvas/audio rendering, encoding and publication are absent.
        > AI: blogs today are Markdown pages (two stubs in `content/blogs`). No scenes, script, audio/visual media or social-media export exist. Decided renderer: deterministic Canvas (see `cmp:/blogs/gen`).
    - [?] **Project Presentations** - `obj:/port/proj` - I can present my projects in not just a descriptive way but a interactive and clear way.
    - [!] **Another Reason to Visit Site** `obj:/port/seo` - A website that only shows the portfolio would only be visited by recruiters who actively and specifically searched for me. By providing client side tools `obj:/work/client`, and `obj:/port/blog` then the site can have better SEO and visitors.
        > **Implementation audit (AI, 2026-11-22):** Client tools and blog feeds work; interactive scene content and its editor are incomplete.
        > AI: the client-side desk and its WASM programs exist; ffmpeg and ImageMagick are not bundled (docs/feat/desk.md).
- [!] **Workspaces** `obj:/work` - the primary interface the owner use for development, management, and work.
    > **Implementation audit (AI, 2026-11-22):** Work chat and desk runtime exist; project/blog management, shared storage and multi-server roles are incomplete.
    - [?] **Public Client Side Desktop** `obj:/work/client` - Provides client sided tools as a desktop environment to achieve `obj:/port/seo` while also respecting privacy (so no personal data goes to the server), and minimizing server load/expenses (so no server process is used).
    - [!] **Personal Server Desktop** `obj:/work/server` - I can login as owner, providing me access to my server allowing me to have portable personal desktop anywhere I go, it also allows me to manage projects where ever I go. Since this runs a personal server I can run automation scripts to automation browser actions `Web` and be able to expose its abilities to the api `API` at `{domain}/api`.
        > **Implementation audit (AI, 2026-11-22):** Server link, terminal and browser code exist; new role routing and isolated versioned custom APIs are absent. No service was redeployed.
        > AI: the agent (`server/`), Durable Object hub and `/server` page code exist; docs/feat/server.md keeps verification on the real Pi, Worker and phone open.
    - [!] **Project Mangement Environment** `obj:/work/project` - The desktop viewing project is readonly but if I am a contributer or owner the desktop becomes editable, the website then becomes my personal project management environment, where I can work on creating/managing/deleting projects.
        > **Implementation audit (AI, 2026-11-22):** Authenticated project creation/edit/delete and collaborative content persistence are absent; Git token access is implemented separately.
        > AI: the desk of a project is read-only for everybody. Repository Files/Version snapshots from the personal server, the contributor Agent menu and `{vfs}/srv/projects` writes are not done (docs/feat/objects.md).
    - [!] **Blog Site Manager** `obj:/work/blog` - When I logged in as owner and view a blog page I can edit the blog script, view its media, and post it.
        > **Implementation audit (AI, 2026-11-22):** No owner scene-script editor, rendered-media manager or publishing integration exists.
        > AI: not implemented, no owner editing of blogs.
    - [!] **Development Environment** `obj:/work/desk` - I am able to install locally on a clean linux environment, and execute with a kiosk/app chrome so it becomes my desktop environment (similar to startx/xinit). This means when when it detects its a desktop environment and together with an chromium extension it interacts with the host system and even manages the positions of the graphical windows.
        > **Implementation audit (AI, 2026-11-22):** Independent Electron desktop and native terminals work; compositor window placement and full host filesystem integration are incomplete.
        > AI: extension + native host with real ptys exist and are tested with a simulated browser; real Chromium/xinit kiosk verification is open, and `cmp:/app` (Electron desktop) is not started.
- [!] **Showcase** `obj:/show` - the system itself implements real technical techniques of several fields, so its own behavior demonstrates the owner's capabilities live.
    > **Implementation audit (AI, 2026-11-22):** Individual techniques work, but SSR/ESR, WebRTC, WebAuthn and the versioned API platform remain incomplete.
    - [!] **Hosting** `obj:/show/host` - The website has a static front using Cloudflare pages so that no server failure causes the website to be unreacable, the servers/services like databases, routing, personal server are all routed by the cloudflare workers so that the website `{domain}` can have both static advantages and dynamic advantages.
        > **Implementation audit (AI, 2026-11-22):** Static hosting and incremental writes work; the specified public server SSR/ESR path is absent.
        - [?] **Content Management System (CMS)** `obj:/show/host/cms` - Enables adding/modifying/remove content in the website very easy as content and system are seperated.
        - [?] **Static Site Generation (SSG)** `obj:/show/host/ssg` - The whole website can be generated statically so that no server is required in hosting them
        - [!] **Incremental Static Regeneration (ISR)** `obj:/show/host/isr` - Instead of generating the whole website every time, it keeps track of the content's dependency tree and updating the branch of the changed files.
            > **Implementation audit (AI, 2026-11-22):** Hash caching and output pruning pass tests; the dependency graph still invalidates broad shared inputs rather than rebuilding only affected branches.
            > AI: pages are skipped when their hash and outputs are unchanged (`.cache/hashes.json`, `graph.ts`); a per-page dependency tree and `HEAD`/manifest based incremental parsing are listed open in docs/feat/engine.md.
        - [?] **Client-Side Rendering (CSR)** `obj:/show/host/csr` - Client side rendering only applies to content that is personal (meaning not worth SEO for), and is dynamic. This includes client details or pages.
        - [!] **Server-Side Rendering (SSR)** `obj:/show/host/ssr` - Server side rendering is only applied to content that is public (meaning indexable by SEO), and is dynamic. This includes the "{domain}/server" where the server sends the status like for fastfetch, local AIoT summary (like for local earthquake detector, etc.), and etc.
            > **Implementation audit (AI, 2026-11-22):** Public fastfetch is an API snapshot; server-generated HTML with a versioned page structure is absent.
            > AI: `{domain}/server` is a client page fed by JSON and WebSocket through `Server_Hub`; `server_route.ts` never returns HTML, so there is no server-rendered HTML yet.
        - [!] **Edge-Side Rendering (ESR)** `obj:/show/host/esr` - This is paired with "{domain}/server", the worker first requests for the page with template handlers and stores them as the template (SSR, because the server generates the HTML page) in the Durable Object, it then asks for the dynamic content JSON where it uses it to update the template handles including its own details to provide the final HTML page. The worker stores the newest dynamic content JSON so that if the server is unavailable it uses it, and it only request the Server Side Rendered HTML page when the structure of the page itself changes, this ensures to save space and minimize worker CPU/Resource use.
            > **Implementation audit (AI, 2026-11-22):** No Durable Object template-version cache or stale dynamic-JSON/template composition exists.
            > AI: no template cache in a Durable Object exists.
        - [?] **Single Page Application (SPA)** `obj:/show/host/spa` - All hyperlinks or any way to another page in the same domain is intercepted by Javascript and prevented, where it then makes a request to the JSON equivelent of that destination and then client side renders the new content ensuring there is a proper loading state, and that time spent on requesting resources to server is minimized. This updates the History API, and it doesnt change the Hyperlinks itself so that right clicking it still provides option to open in new window. This way the website can behave like a single page application.
        - [?] **Read Simple Syndication (RSS) and Atom** `obj:/show/host/rss` - Users can subscribe the blogs in `{domain}/blogs` using RSS or Atom, this way they can be updated to new blogs.
            > AI: no RSS/Atom generator exists (`engine/seo/rss.ts` is the proposed place); `{domain}/blogs` has no feed.
    - [?] **Routing** `obj:/show/route` - All dynamic parts of the website is achieved by the Cloudflare workers routing dynamic pages like `{domain}/server` and `{domain}/api` to their respective dynamic sources. Here `{domain}/api` is not for a specific system but multiple systems like client user management, conversations, automations, etc. where the type of API which can be REST (HTTP methods, status codes, JSON only output), WS, SSE, etc. depends on that root API's manifest details.
        > **Alignment review (AI, 2026-11-22):** Existing output generators and browser runtime have component owners; XML tag schemas live in shared/content/tags. Literal robots/sitemap/header/redirect/service-worker outputs have route files. Full route-family coverage is still the missing Routes capability below.
        > Decided: every fixed API is `/api/_/{id}` (rigid, changed only in this codebase), custom APIs are `/api/{id}/v{n}/...` (managed in `{domain}/server`), and the id `_` is reserved.
        > AI: today they are `/api/health`, `/api/v1/realtime`, `/api/v1/push/*`, `/api/v1/(git|ci)/*`, `/api/server/*`; see `cmp:/cloud/api` for the move.
        - [!] **Representational State Transfer (REST)** `obj:/show/route/rest` - The custom APIs (create by users) in `{domain}/api/{id}/v{version}/{route...}` could contain REST protocols, and the system wide APIs in `{domain}/api/_/{route...}` mainly use REST to maintain system wide resources.
            > **Implementation audit (AI, 2026-11-22):** Fixed APIs and prototype routes work; the versioned custom API contract, QUERY support and server enforcement remain incomplete.
            > AI: system REST routes exist for auth, session, work, push; unfinished work APIs answer `501`.
        - [?] **WebSockets** `obj:/show/route/wsoc` - Side from the custom APIs the system wide APIs use websocket to setup a live messaging.
            > AI: hibernating WebSockets with presence and heartbeat exist in `node/realtime.ts` (to move to `cloud/room`).
        - [!] **Server-Sent Events (SSE)** `obj:/show/route/sse` - Aside from custom APIs the system wide APIs use SSE to setup a notification system so users get notifications live.
            > **Implementation audit (AI, 2026-11-22):** The later human decision limits SSE to custom APIs and uses WebSockets for system notifications. Custom streaming APIs are absent; this description needs reconciliation.
            > Decided: SSE is for custom APIs only (`api.stream`, job and log progress, simple clients like curl or IoT devices). Notifications stay WebSocket while a page is open and Web Push when it is closed, so the objective text above should stop saying system APIs use SSE for notifications.
            > AI: no `EventSource`/`text/event-stream` anywhere today.
        - [!] **WebRTC** `obj:/show/route/rtc` - Aside from custom APIs the system wide APIs use WebRTC to setup user to user audio/video calling.
            > **Implementation audit (AI, 2026-11-22):** No authenticated call signaling, peer-connection lifecycle, media UI or relay configuration exists.
            > AI: no WebRTC code exists.
        - [!] **Webhooks** `obj:/show/route/hook` - The custom APIs support inbound webhooks and triggering outbound webhooks.
            > **Implementation audit (AI, 2026-11-22):** Named owner pipeline hooks now work; custom-api inbound verification and outbound delivery/retry APIs are absent.
            > AI: no inbound/outbound webhook code exists; APISERVER.md phase 2.
        - [!] **Backend for Frontend (BFF)** `obj:/show/route/bff` - The system wide APIs is specifically designed for the frontend because its to be used primarily by the frontend and nothing else, for more varied/general APIs are usually located in the custom APIs.
            > **Implementation audit (AI, 2026-11-22):** Existing session/work/server endpoints serve the frontend; clients/project editing and other specified management endpoints remain incomplete.
    - [!] **User Interface/Experience** `obj:/show/uix`
        > **Implementation audit (AI, 2026-11-22):** Interactive desk and themes exist; accessibility, map interactions and the remaining action behaviors need implementation/audit.
        - [!] **CSS Object Model (CSSOM)** `obj:/show/uix/cssom` - The website tries to optimize CSSOM processing by mainly representing every element with their unique class name with respect to their style and if needed so that styling is O(1), while for handling state in HTML (like input checkboxes, radio, etc.) IDs are used ensuring changes are detected in O(1) *(Like toggling a mode `#mode:checked ~ parent child {}`)*.
            > **Implementation audit (AI, 2026-11-22):** Scoped selectors exist, but constant-time browser selector processing is not an established guarantee; profiling and selector audit remain required.
            > AI: not audited. `check --report tiers` (capability report) is not implemented.
        - [?] **App Shell Architecture as Skeleton Loading** `obj:/show/uix/askel` - The inline CSS (which is loaded long before any other CSS is loaded) provides a skeleton loading template so that once the actual theme loads the transition between them isnt jarring, and provides a more proffessional and smooth loading (inital load and sequential loading) experience.
        - [!] **Compositor-Only** `obj:/show/uix/compose` - Most CSS transitions/animations applys to only transform and opacity which are compository styles minimizing GPU processing and lag, while other transition styles are kept if no other option remains like background position in skeleton loading.
            > **Implementation audit (AI, 2026-11-22):** No complete transition/property audit or representative device performance evidence establishes compositor-only behavior across all themes.
        - [!] **Web Accessibility (WCAG)** `obj:/show/uix/wcag` - The website is fully navigable by the blind, the keyboard only, etc. following WCAG standards.
            > **Implementation audit (AI, 2026-11-22):** No complete WCAG conformance audit, screen-reader pass or contrast/focus review exists. Existing keyboard tests cover selected flows only.
        - [!] **Media Preferences** `obj:/show/uix/preference` - The website's style takes into account the set preferences of the media, if there is prefered reduced motion, color scheme, reduced contrast, etc.
            > **Implementation audit (AI, 2026-11-22):** Some color/motion queries exist; a complete reduced-motion, contrast, forced-colors and theme preference matrix is unverified.
        - [?] **Multi-Themed** `obj:/show/uix/theme` - The website's HTML structure and inline CSS (skeleton loading) are theme agnostic, they provide the structure before the actual Theme CSS, fonts, etc. are loaded. To allow the theme to have full artistic control every icons are font PUA unicode characters aligning their character code to Material Design Icons because it has the highest unique PUA icons of 7,400 icons.
            > **Implementation audit (AI, 2026-11-22):** Existing theme separation and Material Design token/glyph contracts are implemented; visual acceptance of each theme remains human work.
            > **Alignment review (AI, 2026-11-22):** The existing theme switcher, scoped CSS and both font sets remain functional. All 95 token names now use pinned Material Design Icons; both generated fonts and supplementary-plane JSON serialization are verified. The shared canvas/empty-slot renderer does not exist and remains unimplemented.
            > Decided: keep the `[token]` identifiers; change the PUA codepoints to Material Design Icons, with a single token-to-codepoint map (`engine/style/icons.ts`) so the icon set can be swapped quickly if a set has a problem.
            > AI: today `content/theme/default/default.xml` assigns Font Awesome codepoints, `config.json.icons` is an append-only registry and `src/commands.ts icons add` edits it. The registry, the generated fonts, both themes, `content/theme/**/*.scss` and the glyph tests must change together.
            > Must change from Fontawesome standard to Masterial Design Icons
            > AI: today `content/theme/default/default.xml` maps `[token]` names to Font Awesome PUA codepoints and `config.json.icons` is an append-only registry. Switching means a new codepoint map and new token names; decided: keep the `[token]` names and swap the codepoints to Material Design Icons (see `obj:/show/uix/theme`).
        - [?] **No-JS Navigativable** `obj:/show/uix/nojs` - The website should be readable/accessable even if Javascript is disable, this is useful if the user had their Javascript disabled, or if they are using the TOR link `obj:/show/web/tor`, and for CSS Zen Constraint Art purposes. Now alot of features could be disabled like the Desktop but has long the content is navigatable and readable then thats within the objectives.
    - [!] **Website Capabilities** `obj:/show/web`
        > **Implementation audit (AI, 2026-11-22):** PWA/WASM features exist; passkeys, Tor, WebRTC and the explicitly deferred XR capability remain incomplete.
        - [!] **Progressive Web Apps (PWA)** `obj:/show/web/pwa` - Website can be installed as an app, providing offline capabilities (except for `{domain}/desk` and `{domain}/server`), providing error page on more dynamic or heavy content pages.
            > **Implementation audit (AI, 2026-11-22):** Service-worker and push code exist; real-device installation, offline route exclusions and on-device push acceptance still need verification.
            > AI: Web Push with on-device decrypted previews is implemented; docs/feat/pwa.md says tests and real-device checks are pending.
        - [?] **Service Worker** `obj:/show/web/swork` - Allows the website to have notifications in the background and have offline version, also providing the error page on more dynamic or heavy content pages.
        - [?] **Web Workers** `obj:/show/web/wwork` - Runs heavy processes like loading a new page or heavy computations without slowing down the main tread or lagging the user interface
        - [?] **WebAssembly (WASM)** `obj:/show/web/wasm` - Is used to allow Linux in Browser, mostly compiled GNU/applications into WASMs and used in the Desk environment.
            > **Implementation audit (AI, 2026-11-22):** The generic Worker and manifest-owned programs exist and are covered by the WASM regressions. Additional program ports remain independent work.
            > AI: BusyBox ash and about 66 programs run in Workers. Each has its own near-identical worker file, to be replaced by `desk/program/{name}/program.json` plus one generic worker.
        - [?] **WebGL/WebGPU** `obj:/show/web/gl` - Is used to create dynamic and beautiful backgrounds of the website.
        - [!] **WebAuthn** `obj:/show/web/auth` - Is used account deletion to ensure that the user trying to delete the user is the actual user, prevent sabotage and loss of data from the wrong people.
            > **Implementation audit (AI, 2026-11-22):** No credential registration/assertion endpoints or optional passkey settings exist; account deletion still uses session/CSRF/intent without the specified recent-login step-up.
            > Decided: WebAuthn is an optional user setting for big actions (owner login, account deletion). CSRF protection stays mandatory on every cookie-authenticated endpoint, they are not alternatives. Users without a passkey step up by signing in with Google again recently.
            > AI: there is no `navigator.credentials` code; account deletion today uses a CSRF token plus an intent confirmation (`node/auth.ts`).
        - [!] **The Onion Router (TOR) Option** `obj:/show/web/tor` - The website can be accessed through the TOR network and has its own unique onion link alternative
            > **Implementation audit (AI, 2026-11-22):** No Tor service, operator-managed onion identity, Onion-Location or deployment verification exists. A real onion address cannot be invented.
            > AI: not implemented (no onion address, no `Onion-Location`).
        - [!] **Extensions** `obj:/show/web/ext` - Browser extensions specifically chrome is used to allow the desk to also behave like a browser.
            > **Implementation audit (AI, 2026-11-22):** Native host relay exists; third-party browsing/CSP and cookie integration are absent and need a reviewed security design.
            > AI: extension and host exist, real Chromium verification open.
        - [!] **WebXR** `obj:/show/web/webxr` - Not implemented not needed. Maybe in the future if provided VR the website becomes a 3D website where the interface are AR, but missing hardware to actually develop it.
            > **Implementation audit (AI, 2026-11-22):** The owner explicitly deferred XR because hardware is unavailable; no XR implementation or acceptance environment exists.
            > AI: not planned.
    - [!] **Cloud** `obj:/show/cloud`
        > **Implementation audit (AI, 2026-11-22):** Workers/storage/Terraform exist; full account reconstruction and multi-server API/hosting infrastructure are incomplete.
        - [?] **Cloudflare Services** `obj:/show/cloud/cloudflare` - Cloudflare services is primarly used for domain ownership, static hosting (pages), storage (database, durable object, files), and workers.
        - [?] **Monolith** `obj:/show/cloud/mono` - The system wide API `/api/_` uses a single server to handle the whole website's processes, which is the cloudflare workers.
            > **Implementation audit (AI, 2026-11-22):** The fixed system APIs use one Worker dispatcher; unit and workerd/D1 regressions pass.
        - [!] **Microservices** `obj:/show/cloud/micro` - The custom APIs `/api/{id}` can be from multiple servers with cloudflare just keeping track of the manifest for each custom API and their destination.
            > **Implementation audit (AI, 2026-11-22):** The hub still supports one agent; multiple server registrations and versioned API destination routing are absent.
            > AI: no custom APIs exist yet; KV `REGISTRY` only maps demo/work hosts.
        - [!] **Infastructure as Code (IaC)** `obj:/show/cloud/iac` - The whole cloud infastructure should be able to be reconstructed from IaC which in this case we use Terraform on Cloudflare.
            > **Implementation audit (AI, 2026-11-22):** Terraform is unavailable locally; clean-account Access/Tunnel provisioning and remote state are absent. Existing resources must be imported before apply.
            > AI: Terraform covers Pages, Worker, R2, KV, D1 and routes; the remote state backend is not done and `terraform/registry` is to be replaced by `repo.`.
        - [!] **CI/CD** `obj:/show/cloud/cicd` - The CI/CD follows Blue/Green Deployment where are two websites running, the main Blue website at `{domain}` automatically deployed by CI/CD on branch `master`, and the Green website at `staging.{domain}` automatically deployed by CI/CD on branch `staging`.
            > **Implementation audit (AI, 2026-11-22):** Branch-specific pipelines and staging infrastructure code exist; this revision has not been deployed or verified through the real blue/green release path.
            > AI: `.github/workflows/deploy.yaml` exists; provisioning and verifying `staging.jasouza.com` is still open (docs/infra-staging.md).
        - [?] **Containers/Orchestration** `obj:/show/cloud/container` - The whole website system is containerizable as a Docker container containing everything needed to setup as a server in `obj:/show/cloud/micro`, initialize the infastructure `obj:/show/cloud/iac`, and handle CI/CD `obj:/show/cloud/cicd`.
    - [!] **Security** `obj:/show/security`
        > **Implementation audit (AI, 2026-11-22):** JWT binding and sensitive-action revocation tests pass; optional WebAuthn/recent-login step-up and the stronger stated CSP policy remain incomplete.
        - [?] **JSON Web Tokens (JWT)** `obj:/show/security/jwt` - A signed in user has their JWT to represent their logged in session ensuring minimal server compute spent managing sessions
            > Decided: hybrid. A short-lived JWT (about 10 to 15 minutes, signature checked with WebCrypto, no D1 call) in an HttpOnly cookie, plus an opaque refresh token stored hashed in D1 that is checked only when the JWT is renewed. Sensitive actions (account deletion, key changes, owner admin) and WebSocket connect also check D1, so revocation, all-device sign-out and deletion still work. Revocation of ordinary calls takes up to one JWT lifetime.
            > AI: today sessions are opaque HttpOnly cookies stored hashed in D1 (`src/node/auth.ts`), `jose` only verifies Google ID tokens. Add a `kid` to the signing key for rotation. Cookie auth keeps CSRF protection necessary.
        - [?] **OAuth 2.0 / OIDC** `obj:/show/security/oidc` - Signin options like "Signin with Google" uses OIDC which then provides the JWT `obj:/show/security/jwt`
        - [?] **CSRF Tokens / Content Security Policy (CSP)** `obj:/show/security/csrf` - Actions that change an account (sign-out, account deletion, guest linking) need a CSRF token and an intent confirmation, and the generated `_headers` only allow `'self'`, `'wasm-unsafe-eval'` and the hashes of the inline boot script and inline CSS, so injected scripts do not run.
            > AI: CSRF + intent for account actions and CSP hashes in `_headers` exist; the generated headers regression tests (4.7) are still open.
        - [?] **Cache Busting** `obj:/show/security/cachebust` - Everytime the `obj:/show/host/isr` generates the new static assets it uses hashed prefixes in the new files ensuring that browsers not serve stale outdated assets.
        - [?] **Font Subsetting** `obj:/show/security/fontsub` - The fonts are specifically created for the theme `obj:/show/uix/theme` ensuring that only the needed unicode characters are contained and used, preventing wasted space.
    - [?] **Crawlability / SEO** `obj:/show/seo`
        - [?] **Robots** `obj:/show/seo/robots` - `{domain}/robots.txt` is generated from `config.json` (like `/work` being disallowed), and a page can override with `noindex` or `robots`.
        - [?] **LLMS** `obj:/show/seo/llms` - `{domain}/llms.txt` and `{domain}/llms-full.txt` are generated with reference from `config.json`, which points to the site's `{codebase}/content/llms.md` and `llms-full.md`.
        - [?] **Sitemaps** `obj:/show/seo/sitemap` - `sitemap.xml` lists canonical pages with language alternates and `lastmod`, and a `/sitemap` page is generated per language.
        - [?] **JSON-LD** `obj:/show/seo/jsonld` - `WebPage`, `ProfilePage`, `BlogPosting`, `SoftwareApplication`, `WebSite`, `BreadcrumbList` and the owner as `Person` or `Organization` are included in each generated static's page head.
        - [?] **Open Graph (OG) Tags** `obj:/show/seo/og` - Open Graph and Twitter card tags, with a generated 1200x630 cover image drawn for every page.
        - [?] **Semantic HTML5** `obj:/show/seo/html` - Every page has the same fixed skeleton (header, main, footer), ARIA roles on tabs and separators, and a skip link.
        - [?] **URL Slug Optimizations** `obj:/show/seo/slug` - A page's URL comes from its `path` or `id` attribute, never from file names. Public slugs keep their hyphens (`galactic-strike`) and changing one needs a redirect. This is specifically used for `{domain}/projects/{project-name}` and `{domain}/blogs/{blog-path}`




## Components
- [!] **Content** `cmp:/content` - The owner can maintain a complex website has its Content (what is on the page) is located in `{codebase}/content`, allow content teams or editing content easier and in a predictative content layout (`obj:/show/host/cms`). The engine at `{codebase}/engine` scans every file under `{codebase}/content` and identifies how to interpret it from its type and root tag, has all XML root type may live anywhere in the `{codebase}/content` as it has no required folder names or placement rules to allow complete content control owned by the content team/editors, while website-wide paths in the content folder are stored in `{codebase}/config.json`. All content is represented in XML plus attributes without value are equal to "true".
    > **Implementation audit (AI, 2026-11-22):** Content scanning works; scene vocabulary, pipeline desk extensions and several generated families remain incomplete. Content check still reports 39 warnings.
    > Refactor: the schema still tolerates legacy tags `landing`, `contact`, `error`, `resume` (`src/schema.ts`, `src/web/seo_text.tsx`); retire them (docs/feat/content.md). Also open: transitive Markdown/HTML resource discovery. Each tag's schema moves into `engine/tags/{tag}.tsx`.
    > note these contains details only the content editor needs to know, how it works or how its layouted/behave is in their own respective components.
    - [?] **Page** `<page>` `cmp:/content/page` - Represents one navigatable URL, with its identity in navigation and search, and its contents. There can be multiple pages with the same paths as long they have different language.
        - [?] `path` - The page's URL Path, e.g. `/`, `/privacy`. Must be unqiue unless different `lang`
        - [?] `name` - The page's name shown in breadcrumb, dropdown, and head navigation label, e.g. `Portfolio`
        - [?] `icon` - The page's icon shown in head navigation in PUA icon character, e.g. `[home]`
        - [?] `rank` - The page's rank, larger number means shown earlier in navigation order in dropdown or etc.
        - [?] `info` - The page's description used for SEO meta or tooltip
        - [?] `lang` *(optional)* - The page's language which default is the configured default language, e.g. `en`, `ja`
        - [?] `noindex` *(optional)* - Boolean, if true it removes page from search engine files
        - [?] `menu` *(optional)* - Boolean, if false it hides the page from dropdowns, suggestions and search
        - [?] `print` *(optional)* - Name of the print mode used when printing this page `cmp:/content/print`, empty means the browser default
        - [?] `image`, `cover`, `keywords`, `canonical`, `robots`, `lastmod` *(optional)* - SEO Overrides
        - [?] **Hero** `<hero>` `cmp:/content/page/hero` - Provides quick, direct information. Serving as landing pages, contact sections, sitemaps, error pages, etc.
            > **Alignment review (AI, 2026-11-22):** Removed status/profile from schema, authoring and rendering. Print photos are blank editable placeholders; the first published hero supplies the name.
            > Refactor: `src/schema.ts` still accepts `status` and `profile`; remove `status`, and replace `profile` by a placeholder image on print (`html_rirekisho.tsx` reads it).
            > Remove status (unnessary), and profile (is bad practice to put face in resume). While some resume might need profile, their are replaced by placeholder images similar to Rirekisho's editable resume.
            > AI: `src/schema.ts:60` still lists `status` and `profile` as hero attributes, so they are not removed yet. Print layouts read `profile` (`html_rirekisho.tsx`), so that goes with the placeholder work.
            - [?] `name` - Title/Name of the hero, it can be the owner's name on a landing hero, or header for contact error and sitemap heros
            - [?] `tags` - List seperated by commas, shows each tag one at a time, e.g. the landing hero's tags is the owner's roles
            - [?] `info` - Description of the hero
            - [?] `tab` *(optional)* - Header-tab label override, defaults to `name`, e.g. the landing hero's tab is "Home" because its name is the owner's name and is too long for tab label.
            - [?] **Item** `<item>` `cmp:/content/page/hero/item` - An item/entry to a link, these items are grouped into a list box.
                > **Alignment review (AI, 2026-11-22):** Item rendering has its own tag module; print is a validated boolean. Only opted-in published item text feeds print identity fields, using explicit link/icon semantics.
                > Refactor: `print` is a string today, the new rule is a boolean (the text is rendered on print).
                > Turned `print` to boolean because its value isnt really used
                - [?] `icon` - Icon of the item in PUA unicode, e.g. `[contact]`
                - [?] `name` - Name of the item
                - [?] `text` - Text of the link
                - [?] `link` - URL/Source of the link
                - [?] `print` *(optional)* - Boolean, the `text` is rendered on print
                    > **Alignment review (AI, 2026-11-22):** Authored print labels were migrated to booleans, and print extraction ignores unmarked items.
            - [?] **Action** `<action>` `cmp:/content/page/hero/action` - Buttons to toggle actions, mostly links to within inside the website
                - [?] `icon` - Icon on right side of the action in PUA unicode, e.g. `[right_arrow]`
                - [?] `text` - Text of the action, e.g. `Let's work together`
                - [?] `link` - Link of the action, e.g. `/work`
                - [?] `primary` - Boolean, if true it highlights the button.
        - [?] **Expertise** `<expertise>` `cmp:/content/page/expertise` - An interface to allow users to browse the owner's events (experience, education, certifications, competitions) and projects through header tabs, filter chips, timeline graph, and slideshow. The contents of this is detected from every `<event>` and `<project>` root elements, but its children determines what contents to be inserted, no children means no content.
            - [?] **Skill** `<skill>` `cmp:/content/page/expertise/skill` - A tab in the expertise, to filter towards specific events/projects.
                > Refactor: the schema still accepts `info` and `stack` on `<skill>`; remove them (a `<stack>` belongs to many skills).
                > Removed skill's info from outdated version, and <stack> is not a child of <skill> because a <stack> could be used in multiple skills
                - [?] `id` - The ID of that skill, this is used by event or project slide to determine when to show the slide.
                - [?] `icon` - The icon of the skill tab in PUA icon character.
                - [?] `name` - The name of the skill shown in the tab head.
                - [?] `group` - Group label the the skill, has multiple skills can be inside one group like `web-app` and `cloud` inside of `Software`
            - [?] **Stack** `<stack>` `cmp:/content/page/expertise/stack` - A filter chip that determines what slide to render, it can be a tool or technology.
                > Refactor: the schema still accepts `link`, `tag`, `icon` on `<stack>`; remove them.
                > Removed icon, tag, and link from stack, a chip doesnt need them
                - [?] `id` - The ID of that stack, this is used by event or project slide to determine when to show the slide
                - [?] `name` - Name of the stack or filter chip
        - [/] **Desk** `<desk>` `cmp:/content/page/desk` - A desktop environment like workspace used in most dynamic pages like for all of `obj:/work`. Since the content of the desk is usually dynamic, defining the contents of a desk defines its initial behavior (Like starting windows like for `{domain}/desk/png-to-jpeg` to have two windows already opened) or No-JS fallback (so that even without JS there is already windows/menu whos content is already readable without JS but cannot change without JS, very useful for SEO or crawlers).
            > **Continuation (AI, 2026-11-23):** Menu head/map, node placement, Save destinations, per-window volume and fullscreen media controls are implemented for review. Resource comments, grouped desktops, general MIME pipelines, shared VFS and the other explicit gaps below remain unfinished. No live deployment was performed.
            > **Implementation audit (AI, 2026-11-22):** Fixed-window desks now work; interactive maps, menu behaviors and several specified actions are incomplete.
            > **Alignment review (AI, 2026-11-22):** Removed the obsolete server XML attribute; Work runtime activation uses page identity. Authored initial windows and split relationships are supported. Fixed-desk behavior is an absent capability (its checkbox stays empty).
            > Refactor: remove the `server` attribute (the client decides at runtime). Add `fixed` (not in the schema yet). `html_desk.tsx` is 771 lines, split into `engine/tags/{desk,menu,entry,foot,map,window}.tsx`.
            > Removed `server` attribute, because it's relation to server is determined by the client at runtime. Like for example `{server}/work` has a window with path default `im:{owner's email}`
            - [?] `name` -
            - [?] `icon` -
            - [?] `info` -
            - [?] `date` -
            - [?] `fixed` *(optional)* - Boolean, fixes the window setup, meaning no deleting/creating windows. Any request to open a new window instead opens in an existing window and adds to history. This is useful in `{domain}/work` where clients might get lost by accidentally closing a window or opening a new window.
            - [?] `auto` *(optional)* - Boolean, the desk grows with its content and shares the page scrollbar (blogs) instead of filling the viewport
            - [?] **Menu** `<menu>` `cmp:/content/page/desk/menu` - One tab of the desk's side panel menu (e.g. a list of blogs), if contains content it is hard-coded in the XML, rendered as real links, indexable and works without Javascript. At runtime javascript updates the content based on its `path`.
                - [?] **Head** `cmp:/content/page/desk/menu/head` - The desktop menu head has automatic height so its description never overflows or blocks the tabs area.
                    - [?] **Display mode** - A button in the top-right corner of the menu head toggles between `map` and `window` mode. Map mode hides the windows and shows the active menu's map (`cmp:/content/page/desk/menu/map`); window mode hides the map and shows the windows.
                - [?] `name`, `icon` - Tab label
                - [?] `path` *(optiona)* - URI source of the tab: `file:///`, `window:N:/options`, `im:{email}`, or one defined by a plugin
                - [?] **Entry** `<entry>` `cmp:/content/page/desk/menu/entry` - A navigable item (file, folder, message, post, editor entity, sub-event). Entries nest without limit and nesting is sticky, so the chain of parents acts as the breadcrumb.
                    - [?] `id` - Unique ID used for references
                    - [?] `type` - Free keyword, never translated. Known: `File`, `Folder`, `Post`, `Message`, `Note`, `Commit`, `Branch`, `Share`
                    - [?] `name`, `info`, `icon`, `date`, `image` - Display
                    - [?] `data` - The entry's content (text or media reference)
                    - [?] `link` - Where activating it goes (page or window)
                    - [?] `from` - Origin (author, sender, source)
                    - [?] `acts` - Actions available on the entry
                    - [?] `open` *(optional)* - Boolean, initially expanded
                - [?] **Foot** `<foot>` `cmp:/content/page/desk/menu/foot` - Tool strip at the bottom of a menu tab (create file, upload, compose), its children are `<action>` (`icon`, `text`, `link`)
                    - [?] **Action** `<action>` `cmp:/content/page/desk/menu/foot/action` - The tool action to manage the entries.
                        - [?] `icon` - Icon of action
                        - [?] `text` - Text of action
                        - [?] `link` *(optional)* - Link of action
                - [?] **Map** `<map>` `cmp:/content/page/desk/menu/map` - A zoomable node-and-arrow diagram of what the menu represents. `<map/>` without children is automatic (derived from the menu and live resources), with children it is manual.
                    > **Implementation (AI, 2026-11-23):** Automatic-height head, active-tab map/window toggle, pointer/keyboard pan, bounded zoom, authored coordinates/edges and fallback links are implemented. Automatic graphs include files, windows, split flows and processes; plugins contribute through an abort-scoped host API. Chrome desktop/portrait and model/render contracts pass. Supersedes older map gap notes below.
                    > **Implementation audit (AI, 2026-11-22):** Static map output exists; runtime pan/zoom, live resource nodes and consistent map/window toggling are absent.
                    > AI: static map fallback links are rendered; map toggling, pan and zoom are open (docs/feat/desk.md).
                    - [?] `layout` *(optional)* - `tree`, `flow` or `graph`
                    - [?] **Node** `<node>` `cmp:/content/page/desk/menu/map/node` - A node in the graphical map representation
                        > **Implementation audit (AI, 2026-11-22):** Node markup exists; live node/window binding, selection synchronization and map interactions remain incomplete.
                        - [?] `id` - Unique ID of the node
                        - [?] `name` - Message to show in node
                        - [?] `icon` *(optional)* - Icon of node, can allow URL images
                        - [?] `info` *(optional)* - Information/body of ndoe
                        - [?] `link` *(optional)* - Link when node is clicked
                        - [?] `x`, `y` *(optional)* - Position of node
                    - [?] **Edge** `<edge>` - Represents an arrow/line/etc.between nodes
                        - `from` - The starting node's ID
                        - `to` - The ending node's ID
                        - `text` - The message between them
            - [?] **Window** `<window>` `cmp:/content/page/desk/window` - Represents a resource contained in a window. It has its own URI of `window:{id-number}` to indicate cloned/modified version of split windows (like for example the path of split windows with different type or mode, note the path is different if comparing resource instead).
                > **Alignment review (AI, 2026-11-22):** Replaced authored mode with view/edit booleans and added validated 1-based split references to earlier windows. Existing full/save/data/flow behavior is retained and documented. Runtime-internal mode remains an implementation value.
                > Refactor: replace `mode` with boolean `view` and `edit`, add `split`. The schema also has `full`, `save`, `data`, `flow` not listed here: decide which to document or remove.
                > Changed `mode` into two boolean attributes `view` and `edit`
                - [?] `icon` - The window's icon, this time it also accepts URL not just PUA unicode icons.
                - [?] `type` - The type/MIME of the resource, empty means undetermined. Changing it changes how the file is treated (an image as `text/plain` shows as text).
                - [?] `view` *(optional)* - The window views the resource (default).
                - [?] `edit` *(optional)* - The window edits the resource
                - [?] `path` - URI of the resource, if empty shows empty window (upload,select folder, etc.),
                - [?] `split` - Specifies the parent split window by ID

        - [?] **Style** `<style>` `cmp:/content/page/style` - A page specific stylesheet `<style src="x.css" media="print"/>`, copied as written (no scoping), so its selectors should start with the page's body class. The page JSON lists it so SPA navigation adds/removes the `<link>`.


    - [!] **Project** `<project>` `cmp:/content/project` - Represents projects in `{domain}/projects`, its a instance of page meaning it generates a `<page>` with `<desk>`. One element produces `/projects/{id}` (the path is fixed by the type), its desk, its expertise entries (one per slide), and the `/projects` listing. `{id}` is also the bare repository `{repos_dir}/{id}.git`, the clone URL `repo.{domain}/{id}`, the subdomain redirect `{id}.{domain}`, and the viewable in `{vfs}/srv/projects/{id}` if public.
        > **Implementation audit (AI, 2026-11-22):** Project pages/research/Git access exist; contributor editing, public VFS mounts and complete source/package behavior are incomplete.
        > **Alignment review (AI, 2026-11-22):** Project/page vocabularies are independent; project stack was removed, collaborators/confidental and ordered typed repository sources are validated. Server Git enforces collaborator access and confidential sources are not published. Authenticated private/confidential project VFS mounts do not exist; the private-resource workflow remains unimplemented.
        > Refactor: remove `stack` (slides own stacks), add `collaborators` and `confidental`, change `repo` to the typed list, and remove `private` handling that bypasses `{vfs}` (see `private`/`confidental` text). The schema's `page_attrs` still shares attributes between page, project and event (`stack`, `feature_stack`, `skill`, `media`...): split them per tag.
        > Removed `stack` because thats the role of slide
        > Added `collaborators` and `confidental`
        - [?] `id` - Unique identifier
            > **Alignment review (AI, 2026-11-22):** Project authoring, catalog, server configuration and host routing share DNS-label validation and reserved names in shared/content/ids.ts. Cross-entity allocation still requires the missing namespace registry noted below.
            > Refactor: apply the Subdomain IDs rule of `cmp:/cloud` (DNS label syntax, reserved names, never ending in `-demo`).
        - [?] `name` - Name of project
        - [?] `date` - Date of project shown in timeline
        - [?] `short` *(optional)* - Short description shown in menu's head
        - [?] `sub` *(optional)* -
        - [?] `note` *(optional)* -
        - [?] `role` *(optional)* -
        - [?] `rank` *(optional)* -
        - [?] `icon` *(optional)* -
        - [?] `featured` *(optional)* -
        - [?] `collaborators` *(optional)* - Collaborator's emails seperated by commas
            > **Implementation audit (AI, 2026-11-22):** The schema, declaration catalog and Git access checks carry normalized collaborator emails; the focused access regressions pass.
        - [?] `private` *(optional)* - Not shown in the static compiled output nor in any other processes, it is completely server/edge rendered meaning SEO, crawlers, or any one trying to analyze the website cannot access it or even know it exists, even `git clone/push` couldnt identify it unless authenticated. It is only visible to logged in users who are part of the collaborators or owner. Meaning if the personal server is down, its like that project never existed.
        - [!] `confidental` *(optional)* - Similar to private, but it is included in the compiled static output like public. The only difference is that its codebase is not accessable, the `{vfs}/srv/projects/{id}` is there but cannot be read/opened even by root (because its virtual), and trying to `git clone/push` wont work unless authenticated. Meaning the only way to view the contents of the codebase is to be authenticated.
            > **Implementation audit (AI, 2026-11-22):** Git access and provider fallback restrictions are implemented, but the specified protected virtual project mount does not exist.
        - [!] `repo` *(optional)* - External sources of this project, a comma separated list of `type:value`, in fallback order, e.g. `repo="git:https://github.com/jasouzax/jasouzax.github.io,npm:@jasouza/jazu,docker:ghcr.io/jasouzax/jazu,deb:https://example.com/apt"`. Types: `git`, `npm`, `pypi`, `docker`, `deb`, `rpm`. A bare `https://...` means `git:`. They are the upstream the personal server synchronizes with and the fallback `repo.{domain}` uses when the personal server is down (`cmp:/cloud/repo`). Never used as fallback for `private` or `confidental` projects, never for push.
            > **Implementation audit (AI, 2026-11-22):** Typed sources and Git fallback exist; npm/PyPI/package origin serving and verified non-Git fallback clients are absent.
            > **Alignment review (AI, 2026-11-22):** The ordered git/npm/pypi/docker/deb/rpm list is parsed and validated, including bare Git URLs. The existing server sync and pinned read fallback use the first Git source. Publishing the full typed source registry to KV and package-source fallback protocols are absent capabilities.
            > AI: today `repo` is a single git remote (`repository_remote()` in `src/pipeline_types.ts`) read by `src/node/repo_sync.ts` and by the Worker's `git_read_proxy.ts`. Extend the parser to the typed list, keep bare URLs working, and publish only the public sources into KV key `repo:{id}` at deploy time so the Worker never reads content at runtime.
        - [?] `website` *(optional)* -
        - [?] `source` *(optional)* -
        - [?] `paper` *(optional)* -
        - [?] `event` *(optional)* -
        - [?] `lang` *(optional)* -
        - [?] **Slide** `<slide>` `cmp:/content/project/slide` - A slide representation of the project for one or more skills, no children.
            > Refactor: the schema calls it `feature_stack` (and has `description`), this document says `featured_stack`. Decide one name and migrate the content (`content/projects.xml`); `private` on a slide is allowed today but the rule says only the parent has it.
            > Removed `private` because thats the parent's responsibility
            - [?] `skill` - Skill/s of the slide
            - [?] `info` -
            - [?] `media` -
            - [?] `poster` -
            - [?] `alt` -
            - [?] `stack` -
            - [?] `featured_stack` -
            - [?] `hashtags` -
            - [?] `tags` -
            - [?] `featured` -
        - [?] **Research** `<research>` `cmp:/content/project/research` - At most one per project, generates the **Overview** menu `cmp:/desk/over`.
            > Refactor: rename `<literature_review>` to `<similar>` (`research_sections` in `src/schema.ts`, `html_sections.tsx`, content, tests/migration).
            > Renamed `literature_review` with `similar`
            - [?] `<terminology>` - contains the details about the project like the logo, the name, the history, the slogan, etc.
            - [?] `<problem>` -
            - [?] `<solution>` -
            - [?] `<significance>` -
            - [?] `<objectives>` -
            - [?] `<similar>` -
            - [?] `<frameworks>` -
            - [?] `<methodology>` -
            - [?] `<results>` -
            - [?] `<point>` - Every element from `<terminology>` to `<results>` has `<point>` as children representing one point, it can also have other `<point>` children to represent sub points, this can happen multiple times
                - [?] `name` - Name of the point
                - [?] `icon` *(optional)* - Icon of the point
        - [?] **Pipeline** `<pipeline>` `cmp:/content/project/pipeline` - Represents the pipeline/process/automation of a project, it can trigger when the project changes achieving CI/CD, it can trigger on specific conditions like to run the project as a service or paired with the personal server to run automations, has this only works if the Personal server is running.
            > **Implementation audit (AI, 2026-11-22):** Branch/manual/named-hook triggers now enqueue exact commits. Shared parsing, real Git/queue and signed HTTP/replay tests pass.
            > **Alignment review (AI, 2026-11-22):** Removed poll_seconds from schema, content and server configuration. Queue processing uses native watches; upstream sync runs on startup/source changes or explicit sync. Existing post-receive/manual jobs remain. External hook ingestion and generalized automation triggers are absent.
            > Refactor: remove `poll_seconds`, add `hook`. Scope grows from CI/CD to automation.
            > Pipeline's scope changes from just CI/CD to complete automation with help from `{domain}/server`
            > There should be no polling so no `poll_seconds`, instead there would be a webhook open for github/etc. to call on commit. There should be zero Polling anywhere in the website, as polling is just way to inefficent
            > New trigger methods
            > AI: polling exists today as `poll_seconds` (default 60, 10 to 86400) in `src/node/server_config.ts`, `src/schema.ts` and `src/pipeline_types.ts`, used for upstream git sync. Replacement: the repository hub fires a `post-receive` hook for pushes to `repo.{domain}`, and external hosts call the `hook` URL. `poll_seconds` is removed from the schema.
            - [?] `branch` *(optional)* - The git branch name it keep tracks/follow of, triggering the pipeline if the branch as a commit.
            - [?] `hook` *(optional)* - Triggers if the hook name at `{domain}/api/_/projects/{project_name}/{hookname}` is called
            - [?] **Step** `<step>` `cmp:/content/project/pipeline/step` - Represents one automation step, a step could have another step as a child representing multi-steps, if no commands or action it just acts as a log/point to indicate that step as reached (especiall step with sub-steps).
                > **Alignment review (AI, 2026-11-22):** Command is optional; log-only parents and nested steps execute in author order. Phases inherit and remain ordered. args/credentials require command, and continue retains a failed result while allowing following steps.
                > Refactor: `command` is required today, the rule says it is optional (a step without command is a log point). Add `continue`. `phase` is accepted but unused.
                > Added `continue`
                - [?] `name` - Name of the step to be shown in automation interface
                - [?] `command` *(optional)* - The command to execute
                    > **Alignment review (AI, 2026-11-22):** Empty-command steps log their name without spawning a process.
                - [?] `args` *(optional)* - Requires `command`, its the arguments of the command in JSON array
                - [?] `phase` *(optional)* - Phase to show in automation interface
                    > TODO
                - [?] `timeout_seconds` *(optional)* - Sets timeout requirement before it exits
                - [?] `continue` *(optional)* - Boolean, if true it continues the pipeline even if the step failed
                - [?] `credentials` -
            - [!] `<menu>`, `<window>`, `<action>` - Children to extend generated desk
                > **Implementation audit (AI, 2026-11-22):** Pipeline schema accepts only steps; menu/window/action children and their runtime bindings are absent.
                > TODO
    - [?] **Event** `<event>` `cmp:/content/event` - A period or moment of experience, education, certification or competition. Generates `/events/{id}`, a timeline entry in the expertise and rows in print modes. Its desk has a menu (sub-events as tree) and a main window explaining the selected one, its files are `{vfs}/srv/events/{id}`.
        > **Alignment review (AI, 2026-11-22):** Removed resume_start/resume_end; dates drive history wording. resume remains solely for license classification. Nested event navigation now lives in engine/tags/event.tsx.
        > Refactor: remove `resume_start` and `resume_end` (the `date` range does it); verify `resume` is still needed.
        > Removed `resume_start` and `resume_end` since that is the responsibility of `date` which accepts start and end dates for the lience history start/end. Not sure why need `resume`
        - [?] `id` -
        - [?] `name` -
        - [?] `date` -
        - [?] `sub` -
        - [?] `icon` -
        - [?] `info` -
        - [?] `note` -
        - [?] `image` -
        - [?] `type` -
        - [?] `skill` -
        - [?] `stack` -
        - [?] `featured` -
        - [?] `resume` -
        - [?] `lang` -
        - [?] `<event>` - Can include child events and grandchildren events and so on. It is identified through `{domain}/events/{event}/{subevents...}`, `{vfs}/srv/events/{event}/{subevents.}/`.
    - [!] **Blog** `<blog>` `cmp:/content/blog` - Blogs represent any medium of sharing information, they are extensions of desktop with `auto` enabled meaning the desktop is scrollable instead of having strict within grid template. The script/content of the blogs is used to create direction which can be compiled into a video to be posted to social media.
        > **Implementation audit (AI, 2026-11-22):** Only Markdown/menu/window blog expansion exists. Scene schema, Canvas timeline, audio and encoding are absent.
        > Refactor: complete content change: `<scene>`, scene-children `<window>`, and the Canvas renderer (see `cmp:/blogs/gen`). Today only `menu` and `window` children exist.
        > Complete blog content change
        > Decided: blog video is rendered by a deterministic Canvas engine (Remotion-like): every frame is a pure function of time `render(t)`, no headless browser or ffmpeg capture. The reader sees it live at a lower quality at 60 fps; the Render action renders frame by frame at 1080p in its own time and encodes it (WebCodecs).
        > AI: nothing of this exists yet. Today `<blog>` accepts only `menu` and `window` children and blogs are Markdown (`content/blogs/*/index.md`, two stubs). Add `<scene>` in `engine/tags/scene.tsx`, the timeline/canvas player in `desk/` and a `render` action.
        > Explain blog in more detail based on this example: If I want to make a Rust Tutorial I create the first blog `{domain}/blogs/rust/intro` from `<blog id='intro' ...>`. Then I set the first scene `<scene name="What is Rust?">` which represents a slide like scene when converting to video, when in reading mode it becomes like a header `<h2>What is Rust?</h2>`. In this scene I can enter elements like script, enumeration, diagrams, etc. This can also be a window inside, for the rust content I can put a window with path `{srv}/srv/blogs/rust/intro/sample.rs` with two window, one parent window is with mode edit and the child split window is mode view so they can see the hello world work. Basically `<blog>` acts like an engine to create content like Manim, Remotion, etc. In other words `<blog>` is code(xml)-to-content(media and webpage).
        - [?] `id` - Unique blog identification with respect to siblings meaning `intro` is accepted if no sibling as `intro` ID too
        - [?] `name` - Name of the blog
        - [?] `date` -
        - [?] `icon` -
        - [?] `info` -
        - [?] `lang` -
        - [!] **Scene** `<scene>` - Represents one scene, in videos this is like a slide or group of slides/environments, while in blogs this represent one group, a header or subheaders. This can have child `<scene>`
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - [!] **Window** `<window>` - Child windows, in videos this is not interactive meaning whatever content is there stays there and only behaves what it is precoded to do, if in the website it is interactive allowing the user to play with the window. Note that since `<desk auto>` is enabled the windows cannot be dragged/created/moved/etc. the user simply scrolls into view of the window.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - > TODO decide what best goes here from other code-to-content in both media and webpage/notebook like output.
    - [?] **Theme** `<theme>` `cmp:/content/theme` - CSS, generated fonts and an optional script that change the whole look without changing any DOM. A theme only styles the fixed DOM, the empty slots (`background_entity_NN`, `foreground_entity_NN`) and the shared canvas, and always supports light and dark mode. Rules are scoped under `:root:where([data-theme="name"])`.
        > **Implementation audit (AI, 2026-11-22):** Existing themes, font generation and Material Design icon token mapping are implemented and tested; remaining artistic/device review is manual.
        > **Alignment review (AI, 2026-11-22):** Material Design glyph migration is complete, including CSS, public token projection, theme glyphs, pinned upstream revision/license and surrogate-pair serialization. Shared canvas/slots are absent; current background adapters remain available until that new renderer exists.
        > Refactor: icon codepoints move from Font Awesome to Material Design Icons while `[token]` names stay (see `obj:/show/uix/theme`). Legacy background trees must still move to the shared canvas/slots contract (docs/feat/themes.md 2.4.2).
        - [?] `name` - Theme ID. Empty or missing makes the **unnamed skeleton theme** (`content/theme/layout.xml`): not selectable, its CSS is inlined in every page, paints the skeleton loading animation, and its `scope="layout"` style supplies the shared geometry named skins inherit. Keep it tiny
        - [?] `label` - Label shown in the theme switcher
        - [?] `icon` - Icon shown in the theme switcher
        - [?] `color` - Browser chrome/head color, `light/dark` pair allowed
        - [?] `js` - Module exporting `mount(root, options)` returning `fade_in`, `fade_out`, `pause`, `resume`, `dispose`, draws on the shared canvas and never creates DOM
        - [?] `background` - `default` uses `background_default.tsx`, anything else uses their respective backgrounds else nothing if unavailable
        - [?] `preload` - Font family to preload
        - [?] **Style** `<style>` `cmp:/content/theme/style` - `src` (SCSS/CSS file or CDATA), `media`, `scope` (`global` or `layout`). SCSS can `@use "jazu:api"` for palette variables, `mode_light`/`mode_dark`/`mode_auto` mixins and the generated expertise state
        - [?] **Font** `<style>` `cmp:/content/theme/font` - Generated at build time to WOFF2/WOFF/COLRv0.
            - [?] `name` -
            - [?] `size` -
            - [?] `role` -
            - [?] `author` -
            - [?] `src` -
            - [?] `weight` -
            - [?] **Pallet** `<palette>` -
            - [?] **Symbol/Character** `<sym>` -
                > **Token-based glyph authoring (human request, implemented in `26d0061`):** author PUA symbols with `char="[home]"` (or another registered token), resolved through `config.json.icons`, instead of copying the numeric Unicode codepoint. `name` is optional and should be omitted when it merely repeats that token. SVG path and width stay on the symbol; literal characters and numeric codepoints remain supported. Aliases sharing one codepoint need only one glyph definition. Both themes now follow this convention (92 unique PUA glyphs covering 95 tokens each). Font regressions verify byte-identical WOFF2 output against numeric definitions; types and content checks pass (71 pages, 39 existing warnings).
            - [?] **Layer** `<layer>` -
    - [!] **Print** `<print>` `cmp:/content/print` - Turns a page into paper/PDF without printing personal data the owner never published. A page opts in with `print="name"`, and for language L the engine picks the `<print>` with that name whose `lang` matches best: exact, prefix wildcard (`en*`), then `*`.
        > **Continuation (AI, 2026-11-23):** The research layout is implemented and verified below; arbitrary layouts, blog books and quotations remain unfinished. This supersedes the older research-layout gap note.
        > **Implementation audit (AI, 2026-11-22):** Selected print SCSS/fonts now compile behind print media; arbitrary layouts, blog books and research-paper layouts remain incomplete.
        - [?] `name` - Required, the mode (`resume`, `rirekisho`, `quotation`, `research`, â€¦)
        - [?] `lang` - List with wildcards, default `*`
        - [?] `size`, `layout` - Paper size (`a4`), built-in layout (default is `name`, implemented: `resume`, `rirekisho`, `research`)
        - [?] `<style>`, `<font>` children - As in themes but scoped to print mode
        - [!] Only published information is used: personal details come from the landing page's first `<hero>` (`name`, `profile`, `<item print="label">`), history from the expertise. Missing values print as empty boxes which can be editted (the user toggle print mode in dev tools, add the content, and then print), nothing is invented/placeholder. Dates/age are refreshed on `beforeprint`.
            > **Implementation audit (AI, 2026-11-22):** Published-data filtering exists, but structured profile/photo fields and every beforeprint/form variant still need acceptance against the current hero contract.
    - [!] **Plugin** `<plugin>` `cmp:/content/plugin` - Provides the behavior of the desk element, this includes which window body handles with resource and their script or WebAssembly or Assets, behavior or actions of menu and window actions (save, upload, new, etc.), or rendering behavior of `<blog>` components (human puppet avatar, music, etc.). Basically the responsibility of `<desk>` is to provide the interface, while `<plugin>` is the behavior and configurable rules of the desktop's components. This way its easier to change a behavior of a desktop's feature without risking affecting every `<desk>` which is used by alot of pages and without fighting the cache which needs to be updated made more easily through cache busting.
        > **Implementation audit (AI, 2026-11-22):** Existing plugin loading and split/edit/compare flows work; complete trigger/conversion graph, blog render plugins and map/resource integration are incomplete.
        > AI: ordered cases and built-in hosts exist; script/WASM manifest publication and byte verification, the flow/convert/compare graph, and moving built-in viewers into declared plugins are open (docs/feat/plugins.md).
        - [?] `id` - Unique identification of the plugin
        - [?] `version` - Version of the plugin
        - [?] `name` - Name shown of the plugin
        - [?] `icon` -
        - [?] `mime` -
        - [?] `path` -
        - [?] `mode` -
        - [?] `options` -
        - [?] `from` -
        - [?] `to` -
        - [?] `flow` -
        - [?] `wasm` -
        - [?] `sha256` -
        - [?] `script` -
        - [?] **Case** `<case>` `cmp:/content/plugin/case`
            - [?] `file` -
            - [?] `error` -
            - [?] `view` -
            - [?] `edit` -
            - [?] `mime` -
            - [?] `url` -
            - [?] `host` - The window body to render `cmp:/desk/window/*`
            - [?] `script` -
            - [?] `child_file` -
            - [?] `child_view` -
            - [?] `child_edit` -
            - [?] `child_mime` -
            - [?] `child_url` -
- [?] **Main Program** `cmp:/src` - The main program is located in `{codebase}/src`, it accepts argument to achieve other capabilities like when ask to generate the static site it handles the filesystem in reading `{codebase}/content` and configuration `{codebase}/config.json`, passing them to engine `{codebase}/engine`, and writing to `{codebase}/dist`. When asked to setup the cloud infastructure it deals with the filesystem to read the `{codebase}/cloud` and config `{codebase}/.env` to setup the infastructure. And so much more, it is in other words the glue holding everything together.
    > Refactor: keep only the CLI and pipeline glue (`main.ts`, `pipeline.ts`, `step/*`); move everything else out per Codebase Layout. Today `commands.ts` (466 lines) holds all commands: `build check serve watch clean icons graph pack deploy node`.
    - [!] **Pipeline Script** `cmp:/src/pipeline` - The main program is the central script to run everything, as such it comes in a pipeline order. For example to build the website you just run `node src/main.ts make`, you can run multiple actions like `node src/main.ts test:content make watch host` or a range `node src/main.ts make-host`, or all `node src/main.ts all` which does everything in order from testing, building, watching, serving, emulating, cloud setup, server setup, make extension, and run desktop environment which is overkill because now you have the same website running in `{domain}` and `localhost` while at the same time opened the desktop environment to the `localhost` (In summary there is actually two redundancies, the step 4 and 5 hosts locally, and step 6 host in cloud so you can pick step 3,4,5,7, or 3,6,7. Another reduncancy is picking between desktop environment from domain which is step 8 and uses extenstion or from localhost which is step 9 using electronjs). This also helps setup, if you want to run locally with emulation just run `node src/main.ts host` or `docker run -p 8080:8080 jazu host`
        > **Implementation audit (AI, 2026-11-22):** All named stages now have entry points, including inst/ext/app; full cloud/server stage semantics depend on missing provisioning and roles.
        > **Alignment review (AI, 2026-11-22):** Implemented step composition, aliases, forward ranges and implemented-step all. Long-running serve/watch/host release subsequent steps after startup. Install/extension/app setup stages are absent.
        > Refactor: the pipeline syntax (`test:content make watch host`, `make-host`, `all`) and the steps `inst test make watch serve host cloud server ext app` do not exist; today there are npm scripts and `build/check/serve/watch/clean/icons/graph/pack/deploy/node`. Map: `inst`=`npm ci`, `test`=`types`+`test`+`check`, `make`=`build`, `host`=`db:local`+`cloud:dev`, `cloud`=`deploy`, `server`=`node`. Zero polling applies to `watch` (native fs watch).
        - [?] `0` **Install dependencies** `inst` - This is the first pipeline that the main program probably cannot execute has it needs those dependencies to actually execute thus is step `0`.
            > Its commands was originally `npm ci`
        - [?] `1` **Checking/Testing** `test` - This step is responsible in checking everything is working and reading for complete usage. This runs checks in `{codebase}/tests` for `{codebase}/engine`, `{codebase}/desk`, `{codebase}/cloud`, `{codebase}/server` and `{codebase}/content`.
            > Its commands was originally `npm run types && npm test && npm run check`
            - [?] `1.1` **Typescript check** `test:ts` - Checks for typescript
            - [?] `1.2` **Engine test** `test:engine` -
            - [?] `1.3` **Content test** `test:content` -
            > TODO
            - [?] `1.4` **Icon test/check** `test:icon` -
        - [?] `2` **Building** `make` - This steps builds everything, reading the content in `{codebase}/content` and its configurations in `{codebase}/config.json` and passes each resource in `{codebase}/engine` and writes the output to the final static website at `{codebase}/dist`.
            > Its commands was originally `npm run build`.
        - [?] `3` **Watching** `watch` - This step watches for any changes in the codebase in `{codebase}/engine,content` using the filesystem's native watch and no polling. It uses the cache of dependent content to determine which content needs to be recompiled or changed instead of rebuilding everything `obj:/show/host/isr`, all updates write on `{codebase}/dist` include deletions of old versions to reduce accumulation of outdated assets and there is less risk has sites now points to the new assets and any caches already have the deleted assets in cache. This step automatically triggers step `2` if there was no build yet. If in a pipeline it continues to the next step without waiting for this step to finish because it never finishes.
            > Its commands was originally `npm run watch`
        - [?] `4` **Serve** `serve` - This serves the `{codebase}/dist` to `0.0.0.0:8080` (configurable in `{codebase}/config.json`) statically, no emulation of cloud. This automatically triggers step `2` if `{codebase}/dist` hasnt been compiled yet. If in a pipeline it continues to the next step when the hosting succeeds, without actually waiting for this step to finish because it never finishes.
            > Its commands was originally `npm run server -- --port 8080`
        - [!] `5` **Emulated** `host` - This simulates the cloud's workers, storage, etc. at `0.0.0.0:8080` (configurable in `{codebase}/config.json`) following `{codebase}/cloud` for complete offline capabilities, meaning if I want to host this website on my LAN completely offline while maintaining all capaibilities then this is the way. It automatically triggers steps `4` if the static hosting is unavailable. If in a pipeline it continues to the next step if the emulated cloud succeeds.
            > **Implementation audit (AI, 2026-11-22):** Worker/D1/static local emulation works; offline identity and personal-server parity are absent. Google OAuth still requires its provider.
            > **Alignment review (AI, 2026-11-22):** host composes local D1 migrations, Wrangler and a loopback-only static asset server behind the public port. It builds missing output and replaces a preceding in-pipeline serve instance. Offline Google identity and personal-server services are absent capabilities, so full offline equivalence is not claimed.
            > Its commands was originally `npm run db:local` and `npm run cloud:dev`
        - [!] `6` **Cloud** `cloud` - This setups the actual cloud infastructure, this requires at least `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `{codebase}/.env` and it will setup the cloudflare infastructure from `{codebase}/cloud` and write any succeeding APIs/Tokens/etc. to `{codebase}/.env` or any missing variables like `ORIGIN_HMAC_SECRET`. After all is done or there isnt any cloud infastructure changes and there as been new `{codebase}/dist` it then pushes the new cloudflare pages
            > **Implementation audit (AI, 2026-11-22):** Read-only preflight and stable generated values now work. Write scopes, automatic Access/Tunnel resources, remote state and clean-account bootstrap remain incomplete.
            > **Alignment review (AI, 2026-11-22):** Existing deploy/setup commands now target cloud/infra and cloud/db. Automatic account/scope preflight and non-overwriting generated-secret persistence are absent and remain empty checkboxes below. No infrastructure apply was run.
            > Please verify that in a clean install and new cloudflare account, these are the only two variables needed and the rest created?
            > AI: not true today. `src/node/deploy.ts` throws without `CLOUDFLARE_API_TOKEN` and forwards `ORIGIN_HMAC_SECRET`, `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET` to Terraform as variables; `.env.example` has 15 variables in total. To reach your goal, `ORIGIN_HMAC_SECRET` must be generated by `cloud` on first run and the Access service token must be created by Terraform. `CLOUDFLARE_ACCOUNT_ID` could be looked up from the token. Tracked in `cmp:/config`.
        - [!] `7` **Server** `server` - This starts the personal server in `{codebase}/server` (`cmp:/server`): the repository hub at `repo.{domain}`, the project pipelines `cmp:/content/project/pipeline`, and the custom APIs at `{domain}/api/{id}`. Electron is used only for its automation browser (`application/auto-site`). If the cloud is initiated (Step `6` has been run) it also configures the Cloudflare Tunnel and Zero Trust Access for the host when they are missing in `{codebase}/.env`. It accepts a role: `server:repo`, `server:ppl`, `server:api`, `server:pipeline`, `server:browser` (`cmp:/server/role`); plain `server` runs every role.
            > **Implementation audit (AI, 2026-11-22):** Repository/pipeline listener exists; role selectors, multi-server allocation, Tunnel bootstrap and isolated custom APIs are absent.
            > **Alignment review (AI, 2026-11-22):** Plain server starts the relocated Node listener and existing repository/pipeline service. Role selectors, automatic Tunnel/Access provisioning and the new custom API execution model do not exist.
            > Its commands was originally `npm run node -- --port 8788`
        - [?] `8` **Desktop extension** `ext` - This compiles the desktop's chrome extension in `{codebase}/extension` so that users using chrome can install the extension and be able partially use the website as a full desktop environment.
        - [!] `9` **App** `app` - This runs `{codebase}/app` (`cmp:/app`), the separate Electron application that opens a graphical window and acts as the desktop environment, with IPC to i3 (X11) and Sway/Hyprland (Wayland), so that `{vfs}` is the host desktop. It does not depend on `cmp:/server`.
            > **Implementation audit (AI, 2026-11-22):** The Electron launch stage works and was smoke-tested; the specified i3/Sway/Hyprland integration and full native VFS are incomplete.
    - [!] **Docker App** `cmp:/src/docker` - Instead of running everythin in `node src/main.ts action` or `npm run action` then docker can be used to allow containerability and ease of installation, as `docker run jazu action`. Flags can be used to:
        > **Implementation audit (AI, 2026-11-22):** Existing container entry modes remain; separate role-aware server and desktop packaging are incomplete. No images were published or replaced.
        > **Alignment review (AI, 2026-11-22):** Container entry accepts serve/host/server and preserves existing content/data flags. Persistent personal bootstrap moved to server/container.ts. A dedicated role-aware Node image and desktop App packaging are absent; the existing browser image remains separate.
        > Refactor: the entry selector (`ops/docker/entry.ts`) picks site, custom content or personal-server mode; once `server/` is separate it should only host or serve. Image publishing moves from `registry.jasouza.com` to `repo.jasouza.com`.
        - [?] **Hosting** - To host just forward the port like `docker run -p 8080:8080 jazu host`
        - [?] **Custom Content** - To run with a different content run `docker run --mount type=bind,src=/path/to/new/content,dist=/content,readonly -v jazu-custom:/data jazu --content=/content`
            > Maybe we can minimize the code so using docker on `Jazu` is easier?
            > AI: `ops/docker/entry.ts` already selects between prebuilt site, custom content and personal-server mode, and images are published to `registry.jasouza.com`. After the move to `repo.jasouza.com` the publish target and `docs/feat/docker.md` change; the entry selector can shrink once `server/` is its own image.
- [?] **Engine** `cmp:/engine` - The engine is responsible in generating the static website and is located in `{codebase}/engine`
    > **Alignment review (AI, 2026-11-22):** Existing rendering moved into engine components, literal route generators, build/bundle and build/write. Markdown is rendered as shared virtual nodes; browser innerHTML/insertAdjacentHTML uses were removed. Filesystem reads used by markup go through load/resource adapters.
    > Refactor: build `engine/` per Codebase Layout; remove string renderers and `innerHTML` uses (`pager.ts`, `search.ts`, `desk.ts`...) in favour of vnodes; isolate filesystem/process IO behind adapters (docs/feat/engine.md).
    > The old `{codebase}/src/web` should be moved here and there is a complete refactoring needed
    > AI: the browser part `src/web/client` is not the engine, it moves to `cmp:/desk` (see Codebase Layout).
    - [!] **Routes** `cmp:/engine/routes` - `{codebase}/engine/routes/` mirrors `{codebase}/dist/` exactly, one generator per output file, so a change to `{codebase}/dist/{path}` is made in `{codebase}/engine/routes/{path}.tsx`. Static outputs are literal paths (`dist/robots.txt` from `routes/robots.txt.tsx`, `dist/_headers` from `routes/_headers.tsx`, `dist/sitemap.xml` from `routes/sitemap.xml.tsx`). Generated families use a bracket segment (`dist/projects/{id}/index.html` from `routes/projects/[id]/index.html.tsx`, `dist/{lang}/...` from `routes/[lang]/...`). A generator may list its inputs so `obj:/show/host/isr` knows its dependencies.
        > **Implementation audit (AI, 2026-11-22):** Existing literal routes plus RSS/Atom have owners; page/assets/font/icon/cover families still bypass a complete dist-mirroring route registry.
        > New: one generator per `dist` output, mirroring `dist/`. Not started; today the equivalent logic is `src/build.ts` (375 lines) calling `render_page` and the `seo*.tsx` files.
        > AI: this is my proposed replacement for the old `_.html.tsx` rule, mirroring the output tree is the only rule that works for every file. Please accept or change.
        > This rule can change to make it more optimal and actually match how the engine works, as long there is a clear rule on if provided path I want to change `{codebase}/dist/{path}` how to identify where to change in `{codebase}/engine/{x}`?
    - [?] **Helpers** - Helpers used by the routes are located in `{codebase}/engine/helper/`. This helps keeps the code readable and clean in the rest of the codebase, the script's name are defined by their helping role so that when reading a TSX and the imports to the helper its easier to trace to the specific helper needing changing.
- [!] **Extension** `cmp:/extension` - The chrome extention in `{codebase}/extension` is to achieve `obj:/show/web/ext` and desktop environment from the website. For instance it allows the desktop to act as a browser inside of the web, if the extension is available and the path is not `{domain}/server` and owner, then it uses the extension to allow websites to be opened inside of the windows. The user as to provide access to 3rd party cookies so that the website's is automatically logged in to their accounts, but not required. The extention just acts to allow the other website to work inside of the main website bypassing CSP, etc. If the host `{codebase}/extension/host` is available then even the terminal or filesystem is shared allowing more desktop environment like capabilities. To use this as desktop environment startx/xinit chromium in kiosk mode and this extention to `{domain}`. It is recommended to use the electronJS with localhost instead for safety purposes but it shows its possible with very bare minimum setup (just install chrome and its extension).
    > **Implementation audit (AI, 2026-11-22):** Packaging and native host tests pass, including ARM64 compiled PTYs; external browsing, reload reattachment and real kiosk acceptance remain incomplete.
    > AI: native messaging host with ptys, installer, strict protocol and a simulated-browser test exist; a real Chromium + `xinit` kiosk session is still to be verified, and reattach after reload is open. `extension/host/pty_shim.py` and `server/assets/pty_shim.py` are duplicates.
- [?] **Desktop** `cmp:/desk` - The desk represents a whole desktop environment, it is used by `{domain}/desk` for `obj:/work/client`, `{domain}/server` for `obj:/work/server`, `{domain}/projects` for `obj:/work/project`, and `{domain}/blogs` for `obj:/work/blog`. It is located in `{codebase}/desk` (browser runtime moved from `src/web/client`). This is far the most important and powerful component in the whole website. Its subcomponents are divided into:
    > **Alignment review (AI, 2026-11-22):** Current browser runtime is relocated by concern, built-in text/hex and PDF/media unified, resource/save/head components extracted, and all programs share one worker entry. Missing filesystem collaboration, map interactions and further programs remain separate empty checkboxes.
    > Refactor: `src/web/client` (142 flat files) becomes `desk/` per Codebase Layout. Replace the 66 `wasm_worker_*.ts` files by one worker and `desk/program/{name}/program.json`. Open: map/window toggling, pan/zoom, plugin flow graph, `/proc` accounting (placeholders), shell session restore, further programs (docs/feat/desk.md).
    - [!] **Filesystem** `cmp:/desk/fs` - Every desk in the webiste `{domain}/desk,server,projects,blogs` share a single shared virtual filesystem. It only changes based on login where if the owner is logged in the `{domain}/server` is the personal server's filesystem (or atleast a docker container of it), and if any other user is logged in or the owner then the home directory (from `/home/user` (anonymos) to `/home/{username}`) and virtual user (`user@jasouza:~$` to `{username}@jasouza:~$`) is updated. Note this is a virtual filesystem represented as `{vfs}` meaning it feels like a single filesystem but is a frankenstein of a filesystem combinging multiple sources like so:
        > **Implementation audit (AI, 2026-11-22):** OPFS/temp/kernel files work; public, Drive and collaboration mounts are absent.
        - [?] **Static** `cmp:/desk/fs/static` - These files in the filesystem are static files created for the filesystem's functionality, this includes `{vfs}/bin,boot,dev,etc,lib,media,mnt,opt,proc,run,sbin,sys,tmp,usr,var`. They cannot be changed unless the server itself changes the desktop which affects every page using desk. Any changes where (mostly by logging in as root) is imitation meaning just refreshing on in another tab of the same website doesnt have this change.
        - [?] **Uploads** `cmp:/desk/fs/uploads` - All uploaded files to an empty window is uploaded to `{vfs}/tmp`, this is to respect privacy as what users upload without intended to remain there would be deleted when the page is closed. This is also an imitation meaning if another window of the same website is open the uploads is not visible there.
        - [?] **Shared** `cmp:/desk/fs/shared` - The directory in `{vfs}/home/user` is stored in the Origin Private File System (OPFS) if the user didnt share any folder, if they did share any folder then the contents is that shared folder through File the System Access API (Local Disk)
        - [!] **Personal** `cmp:/desk/fs/personal` - If the user is logged in then their home directory `{vfs}/home/{username}` points to their account's drive, meaning if they logged in google and they shared their google drive then they can access their google drive through `{vfs}/home/{username}`. If the user didnt share their drive then `{vfs}/home/{username}` just symlinks points to `{vfs}/home/user`. Note that `user` is an anonymonous user, anyone regardless of who can read/write/execute their files/folders, and when a user logged in as someone then their terminal shows `{username}@jasouza:~$`.
            > **Implementation audit (AI, 2026-11-22):** Drive is used for Work key files only. Visitor file storage, identity home paths, permission prompts and conflict copies are absent.
            > AI: Google Drive visitor storage and `{vfs}/home/{username}` are not done (docs/feat/filesystem.md 3.8); Drive is used today only for encrypted Work key files.
        - [!] **Public** `cmp:/desk/fs/public` - Public files like `{domain}/projects` is at `{vfs}/srv/projects`, `{domain}/blogs` is at `{vfs}/srv/blogs`, etc. The files in `{vfs}/srv` is virtual meaning even if someone sudo into root and deleted everything its just an imitation. However these files could actually be written and be persistent, if and only if the user is logged in as a collaborator or owner.
            > **Implementation audit (AI, 2026-11-22):** Published HTTP resources exist, but no consistent /srv projects/events/blogs mount or authenticated persistent writeback exists.
            > AI: mounting `/srv/projects|events|blogs` in the VFS is open (3.7).
        - [!] **Collaboration** `cmp:/desk/fs/collab` - If a desk is a shared between people (e.g. `/projects/calculator` as two developers) then the collaborator's home directory is visible in `{vfs}/home/{usernames...}`, note this is a virtual directory meaning they cannot read it even as `sudo` or `root` because as `root` is a "imitation" used to just run some commands without sandbox, but since collaborator's home directory is virtual they arent really affected by this. Their home directory could be their google drive or their own `{vfs}/home/user` symlinked, but no one else could access it. To share files or collaborate they can interact with shared directories. In most desks its `{vfs}/home/user` because user is a public account, but if on `{domain}/projects` its their project directory at `{vfs}/srv/projects/{project name}` while `{vfs}/home/user` is also their shared directories. (Note to invite a person to share desk go to `{domain}/desk`, open a window to `im:username@domain.com`, and send them an invite to join your filesystem, after they accept you will see their home directory in your filesystem).
            > **Implementation audit (AI, 2026-11-22):** No authorized shared-folder protocol, account isolation, collaborator-home projection or conflict resolution exists.
    - [!] **Submenu** `cmp:/desk/menu` - The desk has menus to act as a central navigation area towards the whole desktop, and each menu as a item that can represent anything navigational item which can also contain child items and so on. A menu must only contain items and nothing else.
        > **Implementation audit (AI, 2026-11-22):** Existing menus work; dynamic windows/groups, version graph and People menus are incomplete.
        - [?] **Files** `cmp:/desk/menu/file` - The Filesystem `{vfs}` can be navigated through here. The entry parent represents folder and entry that cant have children are files. This is visible and equal in every desk, except for `{domain}/server` where its the server's filesystem if logged in as owner. Its map is an interactive diagram of the filesystem, similar to most operating system's Desktop where you can move files anywhere, which is allowed due to `map`'s positional nodes, etc. meaning this map is editable just by dragging.
        - [!] **Chats** `cmp:/desk/menu/chat` - All of the chats the user has, the owner is highlighted. Entry with children are group chats or owner's anonymonous groups. This is visible and equal in every desk. Its map is similar to the filesystem where people can organize their chats graphically in the map, and means the map is editable.
            > **Implementation audit (AI, 2026-11-22):** Encrypted Work chat exists; consistent chat menus and collaboration across arbitrary desk resources are incomplete.
        - [?] **Overview** `cmp:/desk/menu/over` - The overview of the project from problem, objectives, etc. Root parent entries are the project's main overviews (terminology, problem, etc.), and all child entries are points. This is only for `{domain}/projects/*` and its unique of that specific project. Its map act like a project's pinboard, allowing the project's collaborator to map objectives, related literatures, etc.
        - [!] **Windows** `cmp:/desk/menu/windows` - The windows of the desktop, allows windows to be toggled hidden (not even shown in head tabs), allows group windows (Desktops, opening one opens that desktop and their windows while closing everything outside the desktop, it is persistent meaning if I go to `{domain}/desk` which is normally volitile, but if inside a group it is stored in browser or user's drive), and shows parent/child split windows. The parent entries can be group (opens that desktop, perserving what was minimized/etc.), or parent windows (the children are all split windows, you can drop another window inside of it to cause direct comparisons). This is available everywhere except desks with `fixed` attribute because windows cannot be managed here, and only the windows inside groups are persistence and everything outside them is volitile and unique (two tabs on `{domain}/desk` wont share the same window). The map is a node based programming similar to N8N, NodeRed, ComfyUI, etc. The arrows represent parent to child split because the flow of data goes from parent to child (I could create an automation pipeline where window is an image in svg, create a split window to convert to png, create a split window of that and open a `application/auto-js` to send it to stack, etc.).
            > **Implementation audit (AI, 2026-11-22):** Taskbar-style activation exists; hiding tabs/windows and grouped desktop/menu/map synchronization are incomplete.
        - [!] **Versions** `cmp:/desk/menu/version` - The git commits of the project. Top entries are newest commits, parent entries are merge commits with `--no-ff`. This is only for `{domain}/projects,work` (because there is git clone/push to projects and client works). Its map is the git tree including branchs, merges, tags, etc. The node's position is not customizable like the other maps because it is automatically generated based on the git history.
            > **Implementation audit (AI, 2026-11-22):** No live Git commit tree menu with no-ff merge nesting and snapshots is implemented.
            > AI: loading repository Version snapshots from the personal server is open.
        - [!] **People** `cmp:/desk/menu/people` - This menu is only visible to authorized users in `{domain}/people` as stated in `cmp:/people`. Each entry is a person. Its map is the people graph, there are few kinds of edges between people, the `offspring` which represents that the child node is the offsprint of the parent node, `spouse` which represents the two nodes are spouses and is bidirectional, the `friend`/`classmate`/`schoolmate`/`coworker` which represents the that the two nodes are their respective relation and is bidirectional.
            > **Implementation audit (AI, 2026-11-22):** People storage, region grants and graph projection are absent; the menu cannot safely expose nonexistent authorization.
            > AI: no people code exists (no vCard, no `/people` page).
    - [?] **Windows** `cmp:/desk/window`
        > **Alignment review (AI, 2026-11-22):** Existing windows are organized under desk/window; resource/save actions have their own modules. Text/hex share one viewer and PDF uses the media entry.
        > Refactor: the unification applies: `media` also covers PDF (today `desk_pdf.ts` and `desk_media.ts` are separate) and `text` also covers hex.
        > Unified where `media`, `pdf` is just `media`. `text` and `hex` is just `text`.
        - [?] **Media** `cmp:/desk/window/media` - This window showcases media like images, audio, and video. It provides tools to play (slideshow for pictures, and time for audio/video), zoom in/out, etc.
            > **Alignment review (AI, 2026-11-22):** PDF and other media use the media component entry; PDF rendering remains lazy with local versioned PDF.js assets. Existing conversion and uploaded multipage PDF checks pass.
            - [?] **Browse** `cmp:/desk/window/media/browse` - Located on the top it is used to browse the media, in its left is to previous slide/music/episode(media), in the top middle is current media name and under that is media's breadcrumb (albulm, season/episode, etc.), and on the right is go to next media.
            - [?] **Main** - This is the main media, representing the image, audio, video, etc.
            - [?] **Timeline** - This is the dragable timestamp with small veritical ticks representing frames/etc., the current point, the watched part, the loaded part, etc. the top left of the timeline is the current timestamp and on the right top is the remaining time.
            - [?] **Tools** - This are buttons tool located in the very bottom, to use media, like play/pause, subtitles, zoom in/out, rotate, etc.
        - [?] **Text** `cmp:/desk/window/text` - This window shows a number line, toggable hex mode, and text content with color coding.
            > **Alignment review (AI, 2026-11-22):** Code and hexadecimal display share desk/window/text.ts and one text plugin. MIME determines initial text/hex state; toggling and editing behavior are retained.
            - [?] **Line number** - In the left side representing the line number but on hex mode it represent the hex position. In the bottom is a button to toggle hex mode.
            - [?] **Hex editor** -
            - [?] **Text editor** -
        - [?] **Shell** `cmp:/desk/window/shell` -
        - [!] **Notebook** `cmp:/desk/window/note` - Used to view/edit markdown and jupyter
            > **Implementation audit (AI, 2026-11-22):** Markdown reading works; editable notebooks, Jupyter cell execution and persistence are absent.
        - [?] **Folder** `cmp:/desk/window/folder` -
        - [?] **Page** `cmp:/desk/window/page` - HTML
        - [!] **AutoSite** `cmp:/desk/window/autosite` -
            > **Implementation audit (AI, 2026-11-22):** Existing AutoSite automation browser works; final owner/device interaction and the new API integration remain unverified/incomplete.
        - [!] **AutoJS** `cmp:/desk/window/autojs` -
            > **Implementation audit (AI, 2026-11-22):** Existing automation scripts work; isolated script-per-process custom API deployment and its desk controls are absent.
        - [?] **Messages** `cmp:/desk/window/messages` -
        - > TODO
    - [?] **Window actions** - `cmp:/desk/action` - The window head as a list of actions:
        - [?] **Icon** `cmp:/desk/action/icon` - The icon of the window, can be PUA and can be URL to image. Clicking it toggles the window's pin, low opacity for no pin, and opacity for pinned.
        - [?] **History** `cmp:/desk/action/history` - Navigation of the window's history. Note that everytime a history is added it adds to the website history so that a user using phone can just click their native back button to toggle the window to go back a history or browser users using their browser's back/next history buttons to trigger it.
            - [?] **Backward** - goes back a history
            - [?] **Refresh** - reloads the current window
            - [?] **Forward** - goes ahead a history
        - [?] **Resource** `cmp:/desk/action/resource` - This group determines how the window should behave as it provides the resource and the specifications.
            > **Alignment review (AI, 2026-11-22):** MIME/mode controls now live in desk/action/resource.ts; resource state still drives the plugin selector and shared text/media hosts.
            > Refactor: `mode` becomes the `view`/`edit` pair like `<window>`.
            - [?] **Mime/Type** - How the resource should be treated as, it is a 1 to 1 match of MIME following RFC 2045–2047 and RFC 6838. The only exception is the addition of specific mime only existing in this website, which is `application/auto-site` and `application/auto-javascript`.
            - [?] **Path** - URI/URL of the resource, where `file:///` is `{vfs}`
            - [?] **Mode** - A radio input between two mode types: View (View/Execute the resource), and Edit (Edit/Modify the resource)
        - [/] **Specific** `cmp:/desk/action/specific` - this group's actions is sometimes disabled if unavailable, sometimes has badge if has notifications/changes, etc.
            > **Continuation (AI, 2026-11-23):** Volume and Save are implemented; resource-bound Chats remains absent.
            > **Implementation audit (AI, 2026-11-22):** Existing controls work; resource comments, the specified volume interactions and complete save destinations remain incomplete.
            > AI: the Chats action (comments saved to `.cache/chats/`) has no code; Volume and Save exist.
            - [?] **Volume** - When left click toggles mute/sound, when right click or touch (in touch screens) toggles dropdown to show input range so user can drag the volume. Enables when the window could actually allow volume (like text editor has it disabled), has a badge if a sound is playing but is muted, and changes icon based on the toggle status.
                > **Implementation (AI, 2026-11-23):** Shared mute/level state, mouse/touch/keyboard slider, nonaudio disabling, mute glyph and muted-playing badge work for media and remote browser streams. Electron publishes source audibility; remote gain follows the window level. Chrome and gain/protocol tests pass; deployment to the live server remains separate.
                > **Implementation audit (AI, 2026-11-22):** Some media audio controls exist; consistent per-window mute/range behavior across server/media views and touch is incomplete.
            - [!] **Chats** - This toggles comment/chat mode, when active the chat area in the bottom appears. This allows commenting, review, discussion, etc of the resource by selecting the resource (like in text editor you select some text, click the chat button, type your comment/review and click sent, and now that selected line as a comment similar to Google Word. Or when watching a video you can click chat, type the live comment and click send, similar to twitch or youtube. Or in a folder view, you can select a file/folder, click chat and type the comments and send, if no text or file or thing is selected then the comment goes to the whole resource instead). Where the chats goes depends on the resource, if commenting to a file/folder/media it is saved to `{vfs}./.cache/chats/{resource uri}.json`, note that "{vfs}./.cache" depends on the web path, where `{domain}/desk/*` is just `{vfs}~/.cache`, `{domain}/events,projects,blogs` is just `{vfs}/srv/events,projects,blogs/.cache`, and `{domain}/work` is through the database. It is disabled if the window doesnt have a plugin that supports the chat, it has a badge if there is a message the user havent read yet (shared root, meaning if you have a unread comment at {vfs}/home/user/src/config.json and you are at {vfs}/srv you will still get the badge because the root `{vfs}` is the same, unless you are in like `im:{user}` or etc.). Note that the mesages are shown in the body using the body's own interface like highlighted for commented text, badge in a file/folder containing a comment, or a low opacity comments overlay for media similar to youtube live/comments that gets opacity when hovered or is gone when the chat button is toggled off.
                > **Implementation audit (AI, 2026-11-22):** Work messaging exists, but selections/annotations and resource-bound comment threads are absent.
            - [?] **Save** - Saves the changes of the resource, it is disabled when not savable (like when in view mode, or if view mode cannot save changes like).
                > **Implementation (AI, 2026-11-23):** New/read-only documents choose a VFS folder and filename; overwrite needs explicit selection. Cancel preserves edits; successful saves update the path and subsequent saves reuse it. Chrome verifies durable bytes, overwrite, invalid names, cancellation and existing mirror saving.
                > **Implementation audit (AI, 2026-11-22):** Saving existing writable files works; destination selection/persistent save for new or read-only resources is incomplete.
        - [!] **General** `cmp:/desk/action/general` - These are actions to the window itself and are available everytime except for desk with `auto` or `fixed` because window in that mode cannot be moved.
            > **Implementation audit (AI, 2026-11-22):** Fixed desks now block layout changes; complete auto/fixed control visibility and all remaining general actions need review.
            - [?] **Fullscreen** - Fullscreens the window, when in fullscreen the window looses its border radius and active window outline/border, in certain window bodies like media the window head now renders on top of the body such that if there is no mouse/touch actions after few seconds it fades out including other controls like how it normally does when playing without any interaction but this time the window head also fades out because its fullscreen.
                > **Implementation (AI, 2026-11-23):** Native fullscreen removes frame decoration; video head overlays the media and controls fade after 2.5 seconds during playback. Pointer/touch/keyboard activity restores them; keyboard focus and open tools prevent hiding. Chrome tests exercise entry, idle, reveal and exit.
                > **Implementation audit (AI, 2026-11-22):** Maximizing exists; full media-specific hover/touch header and fullscreen presentation behavior are not fully verified.
            - [!] **Split** - Splits the window to make a child window where the window's resource is directed to the child window that is empty, determining the behavior of the flow of the resource (This uses plugins because this is desktop behavior rules). If the user picks a mime/type in the child window it triggers conversion from parent's mime to child's mime, shown results in child's mime. If the user picks a resource in the child window and is not an executable like `application/*` then it triggers comparisons between parent and child windows. If the user picks a resource in the child window and is an executable then it triggers that executable, replacing the path with `pid:`, and the child's new resource is the executables output/process. If the user picks a resource which is another `pid:` then it adds it, this allows multiple sources into one window. If the user picks a mode in the child window then it triggers clone, meaning its the same resource just different mode (useful if I want to edit a code and see the output at the same time). If the user picks the the chat button it opens chat area (very useful to chat in the same room, like watching a video while reading its comments at the same time, or editing code together with someone and messaging to them live).
                > **Implementation audit (AI, 2026-11-22):** Split editors/compare/image-to-PDF work; arbitrary MIME convert/compare/mirror graph search is incomplete.
            - [!] **Drag/Move** - Can be dragged to move the window with respect to the mouse, when clicked provides a dropdown to move the window based on the direction. In portrait it just moves the window's tab in the head tabs.
                > **Implementation audit (AI, 2026-11-22):** Existing drag/dock and fixed/auto movement guards work; every portrait/touch/menu interaction still needs acceptance.
    - [?] **Window pin** `cmp:/desk/pin` - This determines wither to replace a window with a new window, if a window is not "pinned" which is the default when opening a window or a pre-existing empty window, then opening a window just adds to that window's history. This is useful so that you can browse files/folders/chats/etc. without spawning like a window for everyone of them. To pin a window you can click its icon or you can interact with them like have unsaved work, etc.
- [!] **Projects** `cmp:/projects` - Projects are
    > **Implementation audit (AI, 2026-11-22):** Project rendering and Git access exist; authenticated editing, repository filesystem and research print are incomplete.
    > AI: generation of `/projects`, project pages, expertise slides and Overview menus exist; Files/Version/Agent menus are open.
    > TODO
    - [!] **Git Repo** `cmp:/projects/git` - Anyone can git clone or push a repo from the domain directly like `git clone https://repo.{domain}/myproject` unless it private. In the website collaborators have abilities to modify the filesystem `{vfs}/srv/projects{id}` and manage the git commits.
        > **Implementation audit (AI, 2026-11-22):** Smart HTTP and collaborator tokens pass regressions; authenticated desktop editing and live project snapshots remain incomplete.
        > **Alignment review (AI, 2026-11-22):** Clone/push use repo.<domain>/<id>, with signed origin forwarding and collaborator checks. Website history JSON moved onto the repository host. Shared authenticated collaborator VFS and commit-management UI are absent.
        > Refactor: the clone URL becomes `repo.{domain}/{id}`, see `cmp:/server/repo`. Collaborator writes to `{vfs}/srv/projects/{id}` are open.
        >TODO
    - [?] **Research Paper** `cmp:/projects/paper` - When printed it reveals the research paper
        > **Implementation (AI, 2026-11-23):** Projects opt into the research print layout. Only the matching public language variant's authored research is printed, with ordered sections/nested points. Desktop/navigation disappear; title/date/source link, page numbers and paper geometry remain. The Stesis reference retains its explicit placeholder wording. Unit/privacy and Chrome/PDF checks cover the layout. Arbitrary print layouts, quotations and blog books remain unfinished.
        > **Implementation audit (AI, 2026-11-22):** No research-paper print layout or page opt-in implementation exists.
        > TODO
- [!] **Blogs** `cmp:/blogs` - Blogs represent ideas/thoughts/expression to be shared, although its labled as a blog, its actually also includes any sharable idea like the website can have a tutorial on Electrons like `{domain}/blogs/electronics/ch06-delta-and-start-connection` or any levels from 0 `{domain}/blogs/how-to-setup-docker` to any level `{domain}/blogs/dsa/data/array/stack/c-implementation`.
    > **Implementation audit (AI, 2026-11-22):** Blog pages and subscriptions work; scenes, owner management, video render and book print remain absent.
    > Refactor: complete content change, see `cmp:/content/blog` and `cmp:/blogs/gen`; the `/blogs` listing exists.
    > TODO
    - [!] **Media Generation** `cmp:/blogs/gen` - Deterministic Canvas renderer: live preview at 60 fps and lower quality while reading, `Render` produces 1080p offline (frame by frame, with offline audio mixing). A blog can be generated in a video so it can be published in any social media, so `{domain}/blogs/how-to-setup-docker` can be generated into a video and I can post it in youtube but going to the website provides two capabilies, to interact with the interactive video or view the content used to generate the media (basically the blog/essay/etc.). This is useful if I want to make stories `{domain}/blogs/story/the-last-star-fish`.
        > **Implementation audit (AI, 2026-11-22):** No pure-time Canvas scene renderer, deterministic assets/audio mix, offline WebCodecs encoding or export UI exists.
    - [!] **Book** `cmp:/blogs/book` - When printed it formats into a book template, this allows me to easily produce PDFS/books just by developing blogs. (Like I just go to `{domain}/blogs/electronics` and print it providing a complete PDF book of my blogs on electronics, allowing me to easily work on creating books/papers/etc. of my ideas).
        > **Implementation audit (AI, 2026-11-22):** No book pagination, layout template or blog print integration exists.
    > TODO
- [!] **Server** `cmp:/server` - The personal server in `{codebase}/server` gives the owner a portable computer wherever he goes: logging in as owner and going to `{domain}/server` shows its filesystem, terminal and browser sessions. It is only a Node service that connects **outbound** to the Worker (`cmp:/cloud/hub`) and serves `repo.{domain}` through the Cloudflare Tunnel. Electron is used here only to run the automation browser, it is never a desktop environment (that is `cmp:/app`).
    > **Implementation audit (AI, 2026-11-22):** Current agent, repository and automation browser work; role-aware multi-server routing and the new API process model are absent.
    > **Alignment review (AI, 2026-11-22):** Existing Node repo/pipeline/listener and browser/link/terminal code has its own server root. Browser source modules are ESM with an explicit CommonJS build for Electron. Multi-server roles, role-aware mounts and the new custom API execution model are absent.
    > Refactor: merge `src/node/{server_*,git_*,hook_main,job_*,pipeline*,queue,runner,repo_sync,project_catalog,listener_main,personal}.ts` and today's `server/src/*` into the tree of Codebase Layout. APISERVER.md is the detailed design of `cmp:/server/api`; this file only carries its components and checkboxes.
    - [?] **Link** `cmp:/server/link` - The outbound connection to `cmp:/cloud/hub` carrying the wire protocol shared by agent, Durable Object and page. The `/server` page uses it for the public fastfetch window, the offline state and owner mode.
        > AI: `server/src/{link,link_ws,sign}.ts` and `server/test/link.test.ts` exist, docs/feat/server.md still lists "verify on the real Pi, Worker and a phone" as open.
    - [!] **Roles** `cmp:/server/role` - One personal server can do everything (`node src/main.ts server`) or one role (`node src/main.ts server:{role}`), so several machines can share the work: `server:repo`, `server:ppl`, `server:api`, `server:pipeline`, `server:browser`. A server has an `id` (same DNS label rules as project IDs, default the hostname).
        > **Implementation audit (AI, 2026-11-22):** No role table/selectors, exclusive People lease or overlay server registration exists.
        > Decided: a role is either **overlay** or **exclusive**. Overlay roles may run on several servers and their directories under `{vfs}/srv` are unioned (two servers running `server:repo` both contribute projects). An exclusive role refuses a second server with an error naming the server that holds it (`server:ppl`). `server` without a role runs every role and fails if one exclusive role is taken.
        > Decided: `repo`, `pipeline`, `browser` and `api` are overlay (`api` conflicts only when the same API id is published twice). `ppl` is exclusive because it holds personal details (the owner's people network) and must live on one personal server only. More exclusive roles may be added later, a role declares overlay or exclusive in one table in `server/role.ts`.
        > Refactor: see `cmp:/cloud/hub`.
    - [!] **Network** `cmp:/server/net` - Each server's real filesystem is `{vfs}/net/{id}`, visible only at `{domain}/server` and only to the owner. Logical locations (`{vfs}/srv/projects`, people data) never name a server, they resolve to the union or the owner of the role. In a terminal, `switchnet {id}` attaches that window to the server and the prompt changes from `jason@jasouza:~$` to `{user}@{id}.jasouza:~$`.
        > **Implementation audit (AI, 2026-11-22):** No per-server network mounts, per-terminal switchnet/onnet or logical union resolution exists.
        > AI notes on `switchnet`: it is a good idea if the current server is per terminal window (not global), the prompt always shows it, `switchnet` alone lists servers, `switchnet -` returns to the previous one, a one-off `onnet {id} {command}` runs without switching, and `cd {vfs}/net/{id}` works without switching. It is the same model as `docker context use` or `kubectl config use-context`.
        > Decided: role `repo` overlays `{vfs}/srv/projects/{id}` (the working tree and the build outputs of a project: docker images, deb, dnf, ... packages) and `{vfs}/home/{client username}` (a client's codebase, kept on the personal server for privacy and confidentiality, see `cmp:/work`). `{vfs}/srv/repo` is not used; docs/feat/objects.md and `docs/feat/filesystem.md` still say `/srv/repo/{id}` and must be corrected.
        > Decided: the tunnel hostname of a server is `{id}-server.jasouza.com`. Today's `personal-server.jasouza.com` is the server whose id is `personal` (the default id). The suffix `-server` is reserved for project and work IDs like `-demo` (see Subdomain IDs); a server id has at most 56 characters so the hostname stays a valid label.
        > Refactor: `config.json` `personal_server` (one origin) becomes a list of servers `{id, roles}`; the hostname in `terraform/`, `wrangler.*.jsonc`, `src/node/worker.ts` and `JAZU_SERVER_CONFIG` follows `{id}-server`; each server gets its own Tunnel and Access service token.
    - [!] **Repository Hub** `cmp:/server/repo` - Serves `repo.{domain}/{id}` through the Tunnel. Authentication is by token and the pre-receive hook decides what a pusher may change, so it does not depend on the Worker. `cmp:/cloud/repo` is a thin front that falls back when this is down.
        > **Implementation audit (AI, 2026-11-22):** Git is implemented; personal-server OCI and Linux/library package backends are absent.
        > **Alignment review (AI, 2026-11-22):** Existing Git hub is under server/repo with Tunnel-first repo-host routing. Personal-server OCI/package backends are absent; current pull-only OCI remains an R2-backed cloud component.
        > Refactor: today git is reached as `{domain}/projects/{id}.git` and `/api/v1/git/*` through `src/node/worker.ts`, signed with HMAC; clone and push move to `repo.{domain}/{id}` and the Worker route is deleted. The Pages static mirror at `/projects/{id}.git` is replaced by the fallback sources (`repo` attribute).
        - [?] **Git** `cmp:/server/repo/git` - Smart HTTP clone/push (today `src/node/git_http.ts`, `git_hooks.ts`, `git_mirror.ts`, `git_read_proxy.ts`) with roles from `cmp:/content/project` (`private`, `confidental`, `collaborators`).
            > **Alignment review (AI, 2026-11-22):** Smart HTTP and hooks live under server/repo/git. Project private/confidental/collaborator metadata reaches authorization; unknown/private anonymous discovery has one challenge shape, and owner access is retained. Real clone/fetch/push regressions cover the front and backend.
        - [!] **Container Registry** `cmp:/server/repo/docker` - Replaces `registry.jasouza.com` (today `ops/docker/publish_registry.ts`, `terraform/registry`).
            > **Implementation audit (AI, 2026-11-22):** Current OCI pulls use the cloud R2 registry. There is no Tunnel-first personal-server OCI storage/backend or verified cutover.
            > **Alignment review (AI, 2026-11-22):** There is no personal-server OCI registry component to relocate. The existing R2-backed pull-only cloud registry is preserved and configured for repo.<domain>; its Terraform resources/bucket identities are retained. A Tunnel-first personal OCI backend remains unimplemented.
        - [!] **Linux Packages** `cmp:/server/repo/linux` - apt and dnf repositories.
            > **Implementation audit (AI, 2026-11-22):** This inherited mark was inaccurate. The specified API phase/package backend is absent; the prototype/cloud OCI implementation does not satisfy it.
        - [!] **Libraries** `cmp:/server/repo/lib` - npm, PyPI, Deno, Go.
            > **Implementation audit (AI, 2026-11-22):** This inherited mark was inaccurate. The specified API phase/package backend is absent; the prototype/cloud OCI implementation does not satisfy it.
        - [?] **Reserved IDs** - `apt`, `dnf`, `npm`, `pypi` (and `v1`, `v2`, ... for the docker registry API) are first path segments of `repo.{domain}` and cannot be project or work IDs, see `cmp:/cloud` subdomain IDs.
            > **Implementation audit (AI, 2026-11-22):** One shared DNS-ID rule reserves apt/dnf/npm/pypi and version/service labels; schema and repository access tests cover rejection.
    - [?] **Pipelines** `cmp:/server/pipeline` - Runs `cmp:/content/project/pipeline` for the repository hub. Triggers are `branch` (post-receive on this hub), `hook` (HTTP call) and manual. No polling.
        > **Implementation audit (AI, 2026-11-22):** Named owner hooks now complement branch/manual triggers and queue immutable tips; signed HTTP/replay and real Git tests pass.
        > **Alignment review (AI, 2026-11-22):** Runner/queue/exact-commit execution is retained. Interval polling was removed, including runtime restart detection (now native Git-ref watches). Startup/explicit upstream sync and post-receive/manual jobs exist. External HTTP hook ingestion is absent.
        > Refactor: remove `poll_seconds` (`src/node/server_config.ts`, `src/schema.ts`, `src/pipeline_types.ts`); upstream sync becomes webhook driven. Keep the runner/queue/exact-commit workers, they have real regression tests.
        - [?] **Runner** - Executes steps in isolation with the step's timeout and `continue`.
        - [?] **Queue** - One queue so pipelines do not compete for the Pi.
    - [!] **Custom APIs** `cmp:/server/api` - Owner scripts become APIs at `{domain}/api/{id}/v{version}/...` (design in APISERVER.md). Platform APIs are never here, they are `/api/_/{id}` (`cmp:/cloud/api`), and the id `_` is reserved.
        > **Implementation audit (AI, 2026-11-22):** The old in-process API prototype remains. The referenced APISERVER.md is absent; versioned child processes, stores, manifests and server-owned auth/rate/schema enforcement are not implemented.
        > AI: APISERVER.md is only a design; the Worker answers unknown `/api` routes with `501`. `server/src/api.ts` is the earlier prototype (`new API('sample')`, `API('sample').get(...)`, 30 s handler timeout) and is exactly what APISERVER.md "Differences from the prototype" lists as problems to avoid, so it is to be replaced, not extended.
        - [!] **Phase 1: Core** - manifest extraction, gateway routing only (access, tokens, rate limits and validation are enforced by the server from the API config), JSON envelope and errors, REST verbs including QUERY, scopes, schemas, `api.store`, deploy/rollback, secrets, audit log.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - [!] **Phase 2: Jobs and Hooks** - `api.job`, idempotency, inbound `api.hook` with `verify`, outbound `api.webhook.send`, service tokens, `API.open` client.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - [!] **Phase 3: Streams** - `api.stream` over SSE and WebSocket, channels, resume, stream tickets, `api.socket`.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - [!] **Phase 4: Pub/Sub** - `api.pubsub` for AIoT, OpenAPI and typed-client generation, log streaming.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        - [!] **Phase 5: Live layer** - Durable Object live layer, MQTT bridge, per-owner origin isolation.
            > **Implementation audit (AI, 2026-11-22):** The scene/API-phase implementation is absent. This inherited acceptance mark was inaccurate; the parent issue must be implemented first.
        > Runtime (decided): every script runs as its own child process under the same OS user, environment and filesystem as `node src/main.ts server`, docker confines it to the container, a login as `public` runs it as `public`. There is no container per API. V1 and V2 of an API run side by side as two processes.
        > APISERVER.md section 21, answered (human, 2026-11-22):
        > 1 names are global (`/api/{id}/v{n}`, `_` reserved). 2 service tokens are listed hashed in the API config object of the owner's script and checked by the server, so revoking is instant and no KV denylist exists. 3 and 4 there is no rate limit by default (the owner and close collaborators are not limited, only Cloudflare's own plan limits apply); a public API sets `rate` in its config and the counters live in server memory or in the SQLite next to the `*.auto.js`. 5 streams through Cloudflare count against the plan: warn the owner when a custom WebSocket API is used.
        > 6 and 10: persistence is the builtin SQLite (`api.store`) next to the script, a script that does not use it risks volatile loss; autostart restarts scripts, it does not resume them; job state lives in that SQLite and a job cut by a restart is marked `interrupted`. 7 the manifest edge cache may lag 60 s, no purge; the server enforces access itself so a stale edge copy cannot leak anything. 8 wildcard `*rest` is allowed as the last path segment only, exposed as `params.rest`; precedence static, then parameter, then wildcard; paths are decoded once and `..` is rejected.
        > 9 `version` and an optional `deprecated` date (adds `Deprecation` and `Sunset` headers) are part of the config object passed to `new API(...)`; old versions live until the owner stops them in the desk's `Sessions` menu; versions share one store per API id. 11 `response` in the config is a boolean or a string (`true`, `false`, `'log'`, `'strict'`): checking outgoing responses against the declared schema is the owner's choice, proposed default `'log'`. 12 how connections are held (direct, a Durable Object, a custom threshold) is decided by the owner's script; the platform only guarantees `emit` is independent of the transport.
        > Obsolete in APISERVER.md: sections 3, 6, 7, 8, 9, 12, 14, 17, 18 and the decision log still describe one container per API, container SQLite, container health checks and gateway-side tokens and rate limits. Rewrite them to the child-process model before implementing. Section 15 (Cloudflare free-tier budget) stays valid.
    - [?] **Automation Browser** `cmp:/server/browser` - Electron windows that run `application/auto-site` (sites with their own user data directory) and `application/auto-javascript` (scripts), streamed as frames/audio/input to the `/server` page, so the owner can automate browser actions and expose them through `cmp:/server/api`.
        > AI: this is what `server/src/{web,windows,sites,input,server/audio,server/clipboard,selector,runner,autostart}.ts` do today; it is complete code with unit and smoke tests, but is documented as unverified on the real Pi.
    - [?] **Terminal and Files** `cmp:/server/terminal` - The pty and filesystem channels behind `/server`, and `fastfetch` for the public status window.
- [!] **App** `cmp:/app` - The separate Electron application in `{codebase}/app` that opens a graphical window with the website and is the desktop environment (alternative to chromium kiosk plus `cmp:/extension`). It manages the positions of graphical windows through X11, i3, Sway and Hyprland, and gives `{vfs}` real filesystem, terminal, input, audio and clipboard access. It never connects to `cmp:/server`.
    > **Implementation audit (AI, 2026-11-22):** Independent Electron desk and shared native terminal IPC are implemented; compositor placement, native VFS and full IO integration are incomplete.
    > AI correction: I first assumed the window/input/audio code in `server/src` was this. It is not: it streams automation-browser windows. No i3, Sway, Hyprland, xdotool or wmctrl code exists anywhere in the codebase, so `cmp:/app` is new. The only related code is `extension/host/*` (native-messaging host with real ptys, `pty_shim.py`) and `extension/xinitrc.example`; `app/host` should reuse the same protocol (`shared/`).
    - [!] **Window Manager** `cmp:/app/wm` - Positions native windows; one backend per window manager.
        > **Implementation audit (AI, 2026-11-22):** No X11/i3/Sway/Hyprland window discovery/placement backend or desk-native window projection exists.
    - [?] **Host Bridge** `cmp:/app/host` - IPC offering the same capabilities as `cmp:/extension` host so `cmp:/desk/host` uses one interface.
    - [!] **Input / Audio / Clipboard / Terminal** `cmp:/app/io` - Native access.
        > **Implementation audit (AI, 2026-11-22):** Compiled native PTYs passed on ARM64; native filesystem, global input and full audio/clipboard integration remain incomplete.
- [!] **Work** `cmp:/work` - My clients could message me, through `{server}/work` here we have a shared directory `{vfs}/srv/work/{client username}` where my client's project exists in, similar to Projects collaborators could git clone/push, etc. It also handles quotations and payments.
    > **Implementation audit (AI, 2026-11-22):** Encrypted messaging works; client codebase mounts, project collaboration and personal-server website hosting remain incomplete.
    > AI: chat, encrypted history, Google sign-in, presence, push and account deletion exist (`src/node/work*.ts`, `realtime*.ts`, `auth.ts`, migrations 0001 to 0008, docs/feat/work.md). Not done: shared client directory `{vfs}/home/{client}`, git per client, quotations, payments, per-client durable chat/database adapters, owner audit.
- [!] **Configurations** `cmp:/config` - The website's configurations are stored in two ways, public configuration which can be safely shared publically are stored at `{codebase}/config.json` while private configuration which must be hidden even from git history are stored at `{codebase}/.env`
    > **Implementation audit (AI, 2026-11-22):** Public configuration and private inputs exist; multi-server/work namespace configuration and complete account bootstrap remain incomplete.
    > **Alignment review (AI, 2026-11-22):** Public config and private .env ownership are unchanged; consumers use shared/config.ts, and cloud infra/setup paths are aligned. The complete required-variable/account/scope preflight and generated .env block do not exist.
    > AI: the lists below are what exists today.
    - [?] **Public** `{codebase}/config.json` - Loaded and validated by `src/config.ts`.
        - [?] `base_url`, `site_name`, `owner` (`name`, `email`, `location`, `github`) - Identity.
        - [?] `languages`, `default_language` - UI strings per language (`en`, `ja`).
        - [?] `themes`, `default_theme` - Selectable themes.
        - [?] `icons` - Append-only icon registry (changes with `obj:/show/uix/theme`).
        - [?] `resources` - Tracked site artwork (signature, icon, favicon).
        - [?] `pwa` - Enabled, excluded prefixes, notifications.
        - [?] `deploy` - Pages project and Worker names.
        - [?] `personal_server` - Public origin of the personal server.
        - [?] `pack` - Excludes for `codebase.zip`.
    - [!] **Private** `{codebase}/.env` - Never in git. Goal: the smallest set of variables a human must find by hand. The cloud step (`cmp:/src/pipeline` step `6`) runs a preflight before any Terraform and refuses to continue, listing every problem at once, if a required variable is missing or invalid. After setup the generated values are written back; the user can then go to sleep.
        > **Implementation audit (AI, 2026-11-22):** Generated values are preserved and read probes run before cloud deployment; complete write-scope/Tunnel/Access provisioning is absent.
        - [!] **Required, manual (checked before the cloud step)** - `CLOUDFLARE_API_TOKEN` (and its scopes: Pages, Workers, R2, KV, D1, DNS, Access, Tunnel), `CLOUDFLARE_ACCOUNT_ID` (only when the token sees more than one account), `ORIGIN_HMAC_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (the Google console is the only place they come from). The zone comes from `config.json` `base_url`.
            > **Implementation audit (AI, 2026-11-22):** Presence/format/account/zone/service-read checks are implemented. Read probes cannot prove edit permissions; Google console settings and Terraform write scopes still need validation.
            > Refactor: `src/node/deploy.ts` only fails on a missing `CLOUDFLARE_API_TOKEN` and then forwards the others; write the preflight (token verify, scopes, zone lookup, all required variables) and print all failures together.
        - [!] **Generated after setup, written back** - `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET` (Terraform Zero Trust service token), the tunnel token for `cmp:/server`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (from `owner.email`), `GOOGLE_ADMIN_EMAIL` (from `owner.email`), `JAZU_ASSETS_BUCKET` (from `config.json`), the zone id. They go into a marked block of `.env`, existing values are never overwritten. Terraform state then contains secrets, which raises the importance of the remote state backend.
            > **Implementation audit (AI, 2026-11-22):** Account/zone/admin email, VAPID pair and JWT secret persist without overwrite; Access service-token/Tunnel outputs and complete bucket-output persistence are absent.
        - [?] **Server (optional)** - `JAZU_REPOSITORIES_JSON`, `JAZU_SERVER_CONFIG`.
        - [?] **Delete `WORK_OWNER_TOKEN`** - Delete it from `.env.example` (line 49) and from the fixture in `tests/staging_setup.test.ts` (line 7). No source code reads it and CLAUDE.md says owner-token login was removed.
- [!] **People** `cmp:/people` - I can keep track of family, friends, coworkers, etc. in `{domain}/people`. This is mainly a client side page with no SEO and not shown in breadcrumb's dropdown suggestons or search index. When non-authorized users opens this page it just shows a 404 page. But when authorized people (people who login through `{username}@ppl.jasouza.com` or their own email which is tied to a `{username}@ppl.jasouza.com`) login they see `{domain}/people` which is a desktop with by default the map visible. The details of every person is stored in `{vfs}/srv/person/{name}.vcf` which is mime type `text/vcard`. The authorized user can only access/modify the granted region (My family member can help me complete our family tree and they cannot see my friends and coworkers unless I grant them so). All of this is actually stored in the personal server. The owner sees the website differently, they can see the complete map and filter it because it might be too big, but their window for `text/vcard` is more wider with additional options for their account, like what parts of the people graphs can they access, what email to forward `{username}@ppl.jasouza.com` (If they are already logged in google then I can just assign that logged in user to them), if they can login and what is their password, etc.
    > **Implementation audit (AI, 2026-11-22):** No People vCard datastore, graph, region-grant authorization, account binding or protected page exists.
    > AI: nothing exists: no `/people`, no vCard window, no `ppl.jasouza.com`, no Email Routing.
- [!] **Cloud** `cmp:/cloud` - Cloud services are stored in `{codebase}/cloud`
    > **Implementation audit (AI, 2026-11-22):** Existing Worker/storage/infrastructure code works; the multi-server hub, versioned gateway and clean-account provisioning remain incomplete.
    > **Alignment review (AI, 2026-11-22):** All existing cloud runtime, infrastructure, Wrangler and D1 migration code is under cloud. Router responsibilities are split into index/host/assets/api. Remaining multi-server registry, Email Routing, remote state and custom API platform are absent capabilities.
    > Refactor: move `src/node/{worker,realtime*,auth,google_grant,work*,push*,security,d1_migrate,deploy,publish,serve,server_hub,server_route,server_limits}.ts`, `terraform/`, `migrations/` and `wrangler.*.jsonc` per Codebase Layout. Open: headers/CSP regression tests, Email Routing, analytics, remote Terraform state.
    > Have to move `{codebase}/src/node` relating to the cloud infastructure to `{codebase}/cloud`
    > AI: also `terraform/`, `migrations/` and `wrangler.*.jsonc`. Components that exist as code: `worker.ts` (router), `realtime*.ts`, `auth.ts`, `work*.ts`, `push*.ts`, `server_hub.ts`, `security.ts`.
    - [!] **Router** `cmp:/cloud/router` - The central Worker: subdomain routing, `/assets`, `/api`. Fails closed (`404` unknown host, `501` unfinished API).
        > **Implementation audit (AI, 2026-11-22):** Current host/assets/API routing works; shared work/project allocation and personal-server work hosting are absent.
        > **Alignment review (AI, 2026-11-22):** Current host/assets/API dispatch has separate components. Project redirects, demo proxies, bare Work-ID proxies and fail-closed hosts use shared ID validation. One shared project/work/demo allocation table is absent.
        > Refactor: split `src/node/worker.ts` (206 lines, one function) into `cloud/router/{index,host,assets,api}.ts`. Subdomain rule: `{id}` is looked up in one ID table (projects from the build, works and demos from KV `REGISTRY`), no `-work`/`-demo` regexp. Today `worker.ts` only proxies hosts matching `^[a-z0-9_-]+-(demo|work)$` and redirects hosts that are in the project list.
    - [!] **Hub** `cmp:/cloud/hub` - `Server_Hub` Durable Object that the personal server dials into (`cmp:/server/link`), and the page talks to (`src/node/server_hub.ts`, `server_route.ts`, `server_limits.ts`).
        > **Implementation audit (AI, 2026-11-22):** The current Server_Hub accepts a single agent. Role-aware registration, exclusive leases and multi-server dispatch are absent.
        > **Alignment review (AI, 2026-11-22):** The relocated existing hub still supports one agent. A multi-server registry, role arbitration and channel routing do not exist; replacing that with a new role-aware hub is missing functionality.
        > Refactor: `Server_Hub` accepts exactly one agent and a newer agent replaces the older one (`src/node/server_hub.ts` lines 14 and 84). For `cmp:/server/role` it needs a registry `id -> {roles, apis, status}`, role arbitration (a second exclusive role is refused with an error naming the holder, never silently replaced) and per-server routing of the page's channels.
    > **Custom API follow-up:** the APISERVER versioned manifest/process/store platform is absent. Existing prototype routing remains isolated; it does not satisfy this gateway or the new server API model.
    - [!] **Gateway** `cmp:/cloud/gateway` - Manifest matching, auth, validation and rate limiting for custom APIs `{domain}/api/{id}/v{n}/...` (APISERVER.md section 3).
        > **Implementation audit (AI, 2026-11-22):** Only the legacy gateway prototype exists; versioned manifest matching, child-process ownership and the specified server-side enforcement are absent.
    > **Repository follow-up:** the implemented Git front uses the existing first-Git-source binding; the KV typed-source registry, npm/pypi fallbacks and personal OCI/package backends are unimplemented. Apply the registry Terraform plan and migrate consumers before accepting live hostname cutover.
    - [!] **Repository Front** `cmp:/cloud/repo` - Worker route on `repo.{domain}/*`. It forwards to the Tunnel first; only when the origin fails (timeout or `5xx`) does it read-only fall back to the project's sources in KV `repo:{id}`: git `GET info/refs` and fetch via `302` or the existing pinned read proxy, npm/pypi metadata via `302`. Push, private and confidential projects always answer `503`. Docker/apt/dnf fallbacks only when the client can follow it (to be tested).
        > **Implementation audit (AI, 2026-11-22):** Tunnel-first Git and cloud OCI work; Linux/library backends, all fallback clients and real domain cutover are incomplete.
        > AI suggestion on the `repo="git:...,npm:..."` idea: yes, a typed list is better than a single URL; the changes I propose are (1) a bare URL stays `git:`, (2) the list order is the fallback order, (3) only public sources are written to KV at deploy time so the Worker never reads content, (4) availability comes from the origin failing, not from polling a health endpoint. Because the Worker now sits in front, its cost is one request per git call; streaming uses no CPU. If that ever matters, move only `git-receive-pack`/large clones to a Tunnel-only hostname.
    - [!] **System APIs** `cmp:/cloud/api` - One file per fixed API, `/api/_/{id}` -> `cloud/api/{id}.ts`. A change to behaviour of one of these is a change to this codebase, not to the personal server.
        > **Implementation audit (AI, 2026-11-22):** Session/work/auth/server/push/projects endpoints exist; the Clients API and remaining management contracts are absent.
        > **Alignment review (AI, 2026-11-22):** Existing fixed APIs use /api/_/{id}; browser/agent/service-worker callers and fixtures follow them. Git/CI reads moved to repo.<domain>/<id>/_/ and their old fixed API routes fail closed. Standalone clients API and JWT/refresh sessions are absent.
        > Refactor: today `/api/health`, `/api/v1/realtime`, `/api/v1/push/*`, `/api/v1/(git|ci)/*`, `/api/server/*` and the `/work/*` session routes exist. They become `/api/_/health`, `/api/_/realtime`, `/api/_/push`, `/api/_/server`, `/api/_/session`, `/api/_/auth`, `/api/_/clients`. `/api/v1/git|ci` disappears with `repo.{domain}`. Keep the `{error:{code,message}}` shape and fail-closed behaviour. Update `tests/nodes.test.ts`, the page's fetch calls and `docs/feat/cloud.md`.
    - [?] **Cloudflare** - The whole cloud infastructure is based on cloudflare
        - [!] **Domains**
            > **Implementation audit (AI, 2026-11-22):** Project redirects and existing host routing work; People/work hosting and repository cutover still need implementation/deployment.
            - [?] **Main Domain** `jasouza.com`
            - [!] **Staging Domain** `staging.jasouza.com`
                > **Implementation audit (AI, 2026-11-22):** Staging infrastructure code and a running staging container exist; the new revision has not passed a live staging release and rollback check.
            - [?] **Demo Projects** `{name}-demo.jasouza.com` - MVP or Demo websites for the sake of showcasing or portfolio, the worker routes them to their respective server.
            - [!] **Work Website** `{work id}.jasouza.com` - Proxy to the personal server hosting the client's website. The work ID is chosen freely by the owner (no `-work` suffix).
                > **Implementation audit (AI, 2026-11-22):** No personal-server client-site registry, shared work/project ID allocation or signed work-host proxy exists.
                > **Alignment review (AI, 2026-11-22):** Bare valid Work IDs can resolve existing external HTTPS KV host entries, but client-site hosting on the personal server and the shared ID allocation table do not exist.
                > Refactor: `src/node/worker.ts` accepts only `-demo`/`-work` suffixed hosts today (line 117). Decided: the subdomain is exactly the work ID, see Subdomain IDs below. Demo sites keep `{name}-demo` because `{id}.jasouza.com` is the project redirect.
                > Note that since work and project id must be unique and thus no collisions, its possible to just use the subdomain directly, this more professional this way.
            - [!] **Subdomain IDs** - The ID of a project or a work becomes a subdomain and a path, so one namespace and one rule applies to both.
                > **Implementation audit (AI, 2026-11-22):** Shared syntax/reserved-ID checks exist; atomic project/work allocation across authoring and live D1/KV registration is absent.
                > **Alignment review (AI, 2026-11-22):** A shared DNS-label/reserved-name validator is used by content checks, catalog, server configuration and host routing. Persistent cross-project/work/demo allocation and collision arbitration are absent. registry stays reserved until the operator completes hostname cutover.
                > Rules: DNS label syntax `[a-z0-9-]`, 1 to 63 characters, no leading or trailing hyphen, no `xn--` prefix. Project IDs, work IDs and demo names never collide, and no project or work ID ends with `-demo` or `-server`.
                > Reserved, subdomain collision: `www`, `repo`, `staging`, `ppl`, and the suffixes `*-demo` (demo sites) and `*-server` (server tunnels, today `personal-server`).
                > Reserved, to prevent human error with services: `api`, `mail`, and version-like names `v1`, `v2`, `v3`, ... (the docker registry API is `/v2/`).
                > Reserved, collision with `repo.{domain}` repositories (top-level paths): `apt`, `dnf`, `npm`, `pypi`.
                > AI: `registry` is a live host until the move to `repo.` is finished, treat it as reserved until then. The list lives in one place (`shared/content/` ID rules) read by `check`, the Worker's host router and the work registry.
                > Refactor: today IDs are `/^[a-z0-9][a-z0-9_-]{0,63}$/` (`src/node/worker.ts:46`, `server_config.ts:44`) and `/^[a-z0-9][a-z0-9_-]*$/` (`src/objects.ts:37`): they allow underscores (invalid in hostnames), allow a trailing hyphen and have no reserved list. `check` must fail the build on any violation.
            - [?] **Projects Domain** `{project id}.jasouza.com` - Redirects to `jasouza.com/projects/{project id}`. This also acts as the projects/application's ID in multiple sources like android's `com.jasouza.{project id}`, and it redirects so crawlers dont see duplicate content which could trigger their spam detections.
            - [!] **Repository** `repo.jasouza.com` - This is where the owner's personal repositories are located. A project and a work cannot have the same ID, and a few IDs are reserved for repositories including `apt`, `dnf`, `npm`, `pypi`. It reaches `cmp:/server/repo` through a Cloudflare Tunnel behind the thin Worker `cmp:/cloud/repo`, meaning it is only reachable from the personal server while it is up, otherwise read-only fallback sources apply. It replaces `registry.jasouza.com` and the old `jasouza.com/projects/{id}.git` URL.
                > **Implementation audit (AI, 2026-11-22):** Repository-host Git/cloud OCI code exists; DNS/Terraform cutover and personal package backends remain incomplete.
                > **Alignment review (AI, 2026-11-22):** Code defaults and publish/pull references now use repo.<domain>. The front is Tunnel-first and pins read fallbacks; website Git routes and stale packs fail closed. Registry Terraform apply/DNS cutover is pending human operation, and package/OCI origin backends are missing.
                > Decided: git clone/push moves to `repo.jasouza.com/{id}`. Reasons: shorter URL, one host for git, docker, linux packages and libraries, and a kill switch (stop the tunnel). `{id}.jasouza.com` stays a `301` to the project page because git clients follow redirects inconsistently and crawlers must not see duplicates. The `repo` attribute of `<project>` decides the fallback.
                > Migration: `terraform/registry`, `ops/docker/publish_registry.ts`, `docs/feat/docker.md`, `docs/infra.md`, `.github/workflows/deploy.yaml` and the Pi's pulls still say `registry.jasouza.com`.
                - [?] **Git** - The person can git clone and push though here `git clone repo.jasouza.com/myapp` to get the **Codebase** if the repository allows codebase to be shared
                    > **Alignment review (AI, 2026-11-22):** Origin-first clone/push and pinned public Git-source fallback are implemented at repo.<domain>/<id>; real Smart HTTP clone/fetch and server push tests cover these paths.
                - [?] **Docker** - The person can install a docker image here `docker pull repo.jasouza.com/myapp` to get the **Executable Container** if the repository as a container
                    > **Alignment review (AI, 2026-11-22):** Existing anonymous pull-only OCI is served at repo.<domain>/v2 by the registry Worker. Domain defaults and deployment/pull references are updated without recreating image state. Live cutover needs the operator to apply the reviewed infrastructure change.
                - [!] **Linux** - Repository can be installed like through `deb repo.jasouza.com/apt bookwork main` for debian/API, `baseurl=repo.jasouza.com/dnf` for RHEL/DNF. Allowing owner's packages to be installable on debian if there is a debian executable.
                    > **Implementation audit (AI, 2026-11-22):** No apt Packages/Release signatures or DNF repodata/package serving backend exists. Built package artifacts and signing-key ownership are required.
                - [!] **Libraries** - Libraries can be installed through `npm install --registry=https://repo.jasouza.com/npm` for NodeJS/NPM, `import ... from "[https://repo.jasouza.com/{id}/mod.ts` for DenoJS, `pip install --index-url https://repo.myweb.com/pypi` for Python, `go get repo.myweb.com/{id}` for Go, etc.
                    > **Implementation audit (AI, 2026-11-22):** No npm/PyPI registry metadata, tarball/wheel upload serving, Deno module or Go discovery backend exists.
            - [!] **People** `ppl.jasouza.com` - I use this domain to keep track of people I know, this includes family, friends, coworkers, etc. And when I want them to be a user in my website instead of them taking important usernames in the main domain its `{username}@ppl.jasouza.com`. Going to this subdomain just redirects to `jasouza.com/people`
                > **Implementation audit (AI, 2026-11-22):** No protected People application, verified alias registry or corresponding host redirect is implemented.
        - [!] **Emails**
            > **Implementation audit (AI, 2026-11-22):** Mail forwarding/assistant delivery are not provisioned; destinations and ownership verification must be supplied by the operator.
            - [!] **Owner** `jason@jasouza.com` -
                > **Implementation audit (AI, 2026-11-22):** No mail delivery/DNS acceptance check was performed. Preserve existing mail configuration; the owner's verified destination is required for routing changes.
            - [!] **Assistant** `eva@jasouza.com` - My AI agent running in my personal server as a service of `{domain}/api/{id}` from `{domain}/server`.
                > **Implementation audit (AI, 2026-11-22):** No Eva assistant service or verified receiving/sending identity exists; model/runtime and mail credentials are operator inputs.
            - [!] **Known People** `{username}@ppl.jasouza.com` - Known people in `{domain}/people`, most of these emails dont actually exists, I have to configure it so it forwards emails to their email in `{domain}/people`.
                > **Implementation audit (AI, 2026-11-22):** People region grants and verified forwarding destinations are absent; do not route mail to guessed recipients.
        - [!] **Routing** - Done by the central worker
            > **Implementation audit (AI, 2026-11-22):** Existing routing works; work-site namespace allocation, People routing and multi-server hosting are incomplete.
            > **Alignment review (AI, 2026-11-22):** Existing routing is split by host/assets/API and preserves fail-closed behavior. The shared ID allocation table and personal-server Work hosting remain absent.
            - [?] **Project Apps** - `301` from `{id}.{domain}` to `{domain}/projects/{id}`
            - [?] **Demo** - Proxies `{name}-demo.{domain}` to demo server, using something like `{name}.demo.{domain}` looses cloudflare free SSLs so only 1 level subdomain is allowed.
            - [!] **Work** - Proxies `{work id}.jasouza.com` to personal server hosting client's website (resolved through the shared ID table)
                > **Implementation audit (AI, 2026-11-22):** The external HTTPS Work proxy is not personal-server client hosting; its shared allocation and host selection are absent.
                > **Alignment review (AI, 2026-11-22):** Personal-server client-site hosting and the shared project/work namespace table are absent. The current external HTTPS registry proxy supports a bare valid Work ID.
            - [?] **Other subdomains** - `404` page
            - [?] **Assets** - Object storage with long caching for hashed names, correct `Content-Type` (WASM needs `application/wasm`) and CORS
            - [?] **System wide API** - These APIs connects to the other cloudflare services, they are rounted from `{domain}/api/_/{id}` (`cmp:/cloud/api`), fixed and rigid. System wide APIs IDs includes:
                - [?] **Authentication** `auth` - Is public where the worker uses token verify and session cookie to create a session
                - [?] **Session** `session` -
                    > Refactor: implement the JWT + hashed refresh token hybrid of `obj:/show/security/jwt`; the D1 session table remains the refresh/revocation record. WebAuthn is an optional setting (`obj:/show/web/auth`).
                - [!] **Clients** `clients` -
                    > **Implementation audit (AI, 2026-11-22):** No fixed Clients CRUD API or complete authorized management contract exists.
                - >TODO
            - [!] **Custom API** - These APIs connects to the personal server as configured in `{domain}/server` and is routed from `{domain}/api/{id}/v{n}` (`cmp:/cloud/gateway`). The id `_` is reserved for system APIs.
                > **Implementation audit (AI, 2026-11-22):** The legacy prototype is not the requested /api/{id}/v{n} child-process platform; keep unknown requests fail-closed.
        - [!] **Data Storage** -
            > **Implementation audit (AI, 2026-11-22):** Existing D1/KV/R2/DO/browser storage works; People, collaboration, native mounts and Drive visitor storage are incomplete.
            - [?] **Static Hosting** - Hosts `{codebase}/dist` to cloudflare pages for pages, JSON, CSS, scripts, fonts, SEO, manifest, etc.
            - [?] **Database** - Cloudflare D1 provides SQL to store
                - [?] **Clients** `clients` - Contains
                    - [?] `id` -
                    - [?] `uuid` -
                    - [?] `hash` -
                    - [?] `slug` -
                    - >TODO
                - >TODO
            - [?] **Objects** - Cloudflare R2 provides objects like
            - [?] **KeyValue** - Cloudflare KV provides key value matching used for Demo sites `{name}-demo.jasouza.com` registry, feature flags,
                > TODO
            - [?] **Rooms** - Cloudflare Durable object provides one room per clients,
                > TODO
            - [!] **Personal Server** - Stores repositories `repo.{domain}` and custom services data like `{domain}/server` or `{domain}/people`.
                > **Implementation audit (AI, 2026-11-22):** Repository state persists on the server; role-owned People/custom-service persistence and unified mounts are absent.
                > Decided: the tunnel hostname is `{id}-server.jasouza.com` (today `personal-server.jasouza.com`, the server with id `personal`; the suffix `-server` is reserved in Subdomain IDs). It is protected by an Access service token, HMAC and a loopback-only listener, so it answers `403` to everybody else; hiding the name is not the protection.
            - [?] **Browser** - Stores session and anonymonous client data like filesystem, WASM cache, preferences. Is never uploaded
                > TODO
            - [!] **Drive** - User's own drive like google drive stores filesystems at `{vfs}/home/{username}` and their private keys.
                > **Implementation audit (AI, 2026-11-22):** Encrypted Work key storage exists; account Drive filesystem mounts and file sync/conflict handling are absent.

    > TODO

## Open Decisions
> Everything answered on 2026-11-22 is in the status review at the top. Nothing currently open:
