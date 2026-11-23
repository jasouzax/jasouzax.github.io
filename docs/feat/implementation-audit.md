# Component implementation audit

The original 2026-11-22 pass used feature branches/no-ff merges. The 2026-11-23 continuation works directly on `staging` only, as requested. `[?]` means implemented and awaiting human acceptance. Historical `[!]` labels in the original table used an obsolete convention; current statuses in `COMPONENTS.md` use `[ ]` for absent work, `[/]` for incomplete work, and `[!]` only for human-only blockers. No acceptance marks were invented. This is an implementation attempt and a gap inventory, not completion of every target system.

## Restored provider inputs — 2026-11-23

The restored ignored `.env` passes real token/account/zone/eight-service read checks without changing its bytes. Account-token introspection exposes the required service edit groups. Google distinguishes the restored OAuth secret from an invalid control; no tokens were issued, and full interactive consent is not verified. Provider account inputs are now `[?]`, with no missing-credential human blocker. See [verification details](../src/cloud-preflight.md).

`cloud --preflight` now performs read-only checks, supports account-owned/user-owned token verification and refuses to generate replacement keys already held by the configured Worker. Terraform signing-key aliases are reused. Staging also preserves optional inherited JWT/agent bindings when local input values are null. Root types, focused Node tests, staging Terraform validation and four mocked-provider Terraform tests pass. No live deployment, DNS change or credential rotation occurred; Access/Tunnel bootstrap remains incomplete.

## Staging continuation — 2026-11-23

The menu-head specification was committed first as `4e566ae` with the requested message. `f365c33` implements automatic head height, active-menu map/window mode, accessible pan/zoom, authored maps, live files/windows/flows/processes and plugin resource contributions; it also adds the VFS Save destination picker with cancellation and explicit overwrite handling. The continuation adds draggable/keyboard node placement saved per page/menu, per-window audio controls and native fullscreen video inactivity. `b320d4c` fixes a pre-existing fastfetch test that compared volatile live memory readings from separate snapshots.

Validation: root/server typechecks, static build (71 pages), server build, focused map/render/layout/gain/protocol tests and 16 real Chrome regressions pass across the focused runs. The main suite reports 307 passes, 4 skips and the 4 documented Windows/POSIX filesystem failures. After correcting the volatile-memory assertion, the server suite reports 65 passes, 1 skip and its 7 documented filesystem failures. Content validation reports 71 pages and 39 existing warnings. The desk browser configuration now builds before serving; plain `serve` can reuse stale output. No branch other than staging, live service, DNS, infrastructure state or published image was changed.

Continue from the component statuses, preserving `[?]` for human review. The desktop and Specific actions remain `[/]`: resource-bound comments (including Work persistence/annotations), grouped persistent desktops, full MIME conversion graph and shell restoration/accounting remain unfinished. The broader Blog/People/collaboration/custom API/multi-server/cloud/native application gaps in this inventory also remain open; this continuation does not relabel them as delivered.

## Delivered changes

### Additional continuation — Windows navigation

Non-fixed desks now expose a live Windows menu with split hierarchy, Show/Hide/Close controls, hidden/minimized state and resource-map synchronization. Hiding removes both desktop tiles and header tabs without disposing drafts or processes; keyboard cycling skips hidden tabs. File windows can be dropped under another as comparison children, with ancestor-cycle rejection and stale-parent cleanup. Group persistence is still absent, so Windows remains `[/]`.

Root typechecking, flow/layout contracts and ten Chrome Windows/Version/map regressions pass, including shared unsaved draft restoration, comparison drops, fixed-desk guards and portrait behavior. No live deployment occurred.

### Additional continuation — public Version menus

Public project Version menus now load bounded repository history only when selected. The origin exposes commit parents in topological order and peeled annotated tag targets; the browser validates replies, groups non-first-parent branch commits under merge entries, resolves named refs to hashes, and builds a fixed-position DAG with branch/tag labels. Refresh errors preserve the loaded snapshot. Requests omit credentials, enforce a response-size/time bound, and abort on navigation. Selecting map nodes reveals their commit entry.

Root/server types, server build, real-Git no-ff/tag fixtures, nested-merge validation, Worker regressions and six Chrome Version/map checks pass. Private Work history, older-history pagination and historical file browsing remain open, so Versions stays `[/]`. The matching origin must be deployed with the runtime; no live deployment was performed.

### Additional continuation — research printing

Project `print="research"` now selects a built-in research paper layout through the existing named/language-aware print system. The paper uses only matching-language public research, preserves nested points and placeholder wording, and excludes private projects and repository/collaborator data. Title/date, safe source links, configurable fonts/paper size and page numbers are provided. Screen mode retains the desktop; print mode replaces it with the paper. The English Stesis reference opts in explicitly.

Root typechecking, focused print/page/layout/privacy tests and content validation pass (71 pages, 39 existing warnings). Real Chrome print tests pass for Default and Memory; exported three-page A4 PDFs were rendered with Poppler and inspected, including page breaks and nested headings. Full main/server suite results above remain from the earlier pass; this continuation uses focused regressions for the changed print path. No live deployment occurred.

| Area | Implementation and evidence |
|---|---|
| CLI | `inst` bootstraps npm before dependency imports; `ext` produces a self-contained unpacked extension; forward-range composition tests pass. |
| Fixed desks | Boolean schema/render flag, reused windows/history and layout guards; schema and real Chrome regression pass. |
| Blog subscriptions | RSS 2.0/Atom per language, escaped summaries, hidden-page exclusion and HTML autodiscovery; XML parsing and isolation test passes. |
| Cloud preflight | Manual-input validation, account/zone discovery and service-read probes; stable marked-block VAPID/JWT persistence, no secret logging; synthetic denied/ambiguous-account/preservation tests pass. Full provisioning remains an issue. |
| Authentication | Five-minute HS256 access cookie bound to origin and opaque refresh hash. Discovery can avoid D1; sensitive actions still query it. Node cryptographic and actual workerd/D1 OAuth/revocation regressions pass. Deployment requires `AUTH_JWT_SECRET`. |
| Pipeline hooks | Named XML hooks, owner CSRF endpoint and signed origin forwarding; exact Git tip jobs, unknown-hook rejection and replay checks pass. External provider webhook verification is separate work. |
| Print | Theme SCSS/font adapters and relative assets behind print media; changed-font URL invalidation and prior resume regressions pass. |
| Electron | Independent package/build/CLI stage, sandboxed renderer, top-frame localhost IPC and shared native host. App typecheck/build pass. An initial real Electron load/handshake/navigation smoke passed; two final repeated launches timed out before debugger attachment. Launch reliability and full native desktop integration remain issues. |

## Validation and server observations

The main suite before the final host extraction had 299 passes, 4 skips and the same four Windows/POSIX filesystem failures recorded in the original checklist. The final rerun completed with **302 passes, 4 skips and the same 4 Windows/POSIX filesystem failures** (310 tests). New hook/print/JWT tests and the shared-host regressions passed. The separate server suite has 65 passes, 1 skip and 7 Windows-path filesystem failures. Content validation reports 71 pages and 39 existing warnings. The static build reports 71 pages and the two existing `server:fastfetch` resource warnings. Root/app TypeScript checks and the server build pass. Three final real-Chrome regressions (fixed desks/history, research navigation and home-folder loading) pass. Electron initially passed but its final two launch retries timed out; it remains an explicit issue. No Terraform binary is available locally.

SSH password authentication reached the ARM64 `jasouza` machine. The existing personal, staging and image-registry containers are running; personal reports healthy. Host Node is v20.19.2 and staging-container Node is v24.22.3. Direct TypeScript scripts need the newer runtime. Both compiled shared-host PTY backends (Python and util-linux `script`) passed a real shell/output/exit-code test in an isolated temporary host directory; it was removed afterwards. Running services were not changed. No real account was deleted or mail sent.

## Inventory of previously unfinished entries

Every entry still `[ ]` or `[/]` when the final audit began is listed below; items completed earlier in this pass are described in Delivered changes and marked in `COMPONENTS.md`. Descriptions in `COMPONENTS.md` were preserved. Existing false inherited `[?]` marks for absent API phases/package backends were corrected separately. A parent with missing children remains `[!]`.

| State | Component/objective | Evidence or remaining work |
|---|---|---|
| [!] | `{codebase}/cloud` `cmp:/cloud` | Cloud modules exist, but multi-server registration, versioned gateway, clean-account Tunnel/Access setup and remote state remain incomplete. |
| [!] | `{codebase}/extension` `cmp:/extension` | Native shell bridge and packaging work; external-site embedding, cookie policy and real Chromium kiosk acceptance are incomplete. |
| [?] | `{codebase}/shared` `cmp:/shared` | Shared contracts and native-host runtime have real consumers in multiple roots; the root import-boundary regression passes. |
| [!] | **Portfolio** `obj:/port` | Portfolio browsing works; the interactive scene-blog and owner editing objectives remain incomplete. |
| [!] | **Blogging** `obj:/port/blog` | Markdown blogs and feeds exist; scene authoring, deterministic Canvas/audio rendering, encoding and publication are absent. |
| [!] | **Another Reason to Visit Site** `obj:/port/seo` | Client tools and blog feeds work; interactive scene content and its editor are incomplete. |
| [!] | **Workspaces** `obj:/work` | Work chat and desk runtime exist; project/blog management, shared storage and multi-server roles are incomplete. |
| [!] | **Personal Server Desktop** `obj:/work/server` | Server link, terminal and browser code exist; new role routing and isolated versioned custom APIs are absent. No service was redeployed. |
| [!] | **Project Mangement Environment** `obj:/work/project` | Authenticated project creation/edit/delete and collaborative content persistence are absent; Git token access is implemented separately. |
| [!] | **Blog Site Manager** `obj:/work/blog` | No owner scene-script editor, rendered-media manager or publishing integration exists. |
| [!] | **Development Environment** `obj:/work/desk` | Independent Electron desktop and native terminals work; compositor window placement and full host filesystem integration are incomplete. |
| [!] | **Showcase** `obj:/show` | Individual techniques work, but SSR/ESR, WebRTC, WebAuthn and the versioned API platform remain incomplete. |
| [!] | **Hosting** `obj:/show/host` | Static hosting and incremental writes work; the specified public server SSR/ESR path is absent. |
| [!] | **Incremental Static Regeneration (ISR)** `obj:/show/host/isr` | Hash caching and output pruning pass tests; the dependency graph still invalidates broad shared inputs rather than rebuilding only affected branches. |
| [!] | **Server-Side Rendering (SSR)** `obj:/show/host/ssr` | Public fastfetch is an API snapshot; server-generated HTML with a versioned page structure is absent. |
| [!] | **Edge-Side Rendering (ESR)** `obj:/show/host/esr` | No Durable Object template-version cache or stale dynamic-JSON/template composition exists. |
| [!] | **Representational State Transfer (REST)** `obj:/show/route/rest` | Fixed APIs and prototype routes work; the versioned custom API contract, QUERY support and server enforcement remain incomplete. |
| [!] | **Server-Sent Events (SSE)** `obj:/show/route/sse` | The later human decision limits SSE to custom APIs and uses WebSockets for system notifications. Custom streaming APIs are absent; this description needs reconciliation. |
| [!] | **WebRTC** `obj:/show/route/rtc` | No authenticated call signaling, peer-connection lifecycle, media UI or relay configuration exists. |
| [!] | **Webhooks** `obj:/show/route/hook` | Named owner pipeline hooks now work; custom-api inbound verification and outbound delivery/retry APIs are absent. |
| [!] | **Backend for Frontend (BFF)** `obj:/show/route/bff` | Existing session/work/server endpoints serve the frontend; clients/project editing and other specified management endpoints remain incomplete. |
| [!] | **User Interface/Experience** `obj:/show/uix` | Interactive desk and themes exist; accessibility, map interactions and the remaining action behaviors need implementation/audit. |
| [!] | **CSS Object Model (CSSOM)** `obj:/show/uix/cssom` | Scoped selectors exist, but constant-time browser selector processing is not an established guarantee; profiling and selector audit remain required. |
| [!] | **Compositor-Only** `obj:/show/uix/compose` | No complete transition/property audit or representative device performance evidence establishes compositor-only behavior across all themes. |
| [!] | **Web Accessibility (WCAG)** `obj:/show/uix/wcag` | No complete WCAG conformance audit, screen-reader pass or contrast/focus review exists. Existing keyboard tests cover selected flows only. |
| [!] | **Media Preferences** `obj:/show/uix/preference` | Some color/motion queries exist; a complete reduced-motion, contrast, forced-colors and theme preference matrix is unverified. |
| [?] | **Multi-Themed** `obj:/show/uix/theme` | Existing theme separation and Material Design token/glyph contracts are implemented; visual acceptance of each theme remains human work. |
| [!] | **Website Capabilities** `obj:/show/web` | PWA/WASM features exist; passkeys, Tor, WebRTC and the explicitly deferred XR capability remain incomplete. |
| [!] | **Progressive Web Apps (PWA)** `obj:/show/web/pwa` | Service-worker and push code exist; real-device installation, offline route exclusions and on-device push acceptance still need verification. |
| [?] | **WebAssembly (WASM)** `obj:/show/web/wasm` | The generic Worker and manifest-owned programs exist and are covered by the WASM regressions. Additional program ports remain independent work. |
| [!] | **WebAuthn** `obj:/show/web/auth` | No credential registration/assertion endpoints or optional passkey settings exist; account deletion still uses session/CSRF/intent without the specified recent-login step-up. |
| [!] | **The Onion Router (TOR) Option** `obj:/show/web/tor` | No Tor service, operator-managed onion identity, Onion-Location or deployment verification exists. A real onion address cannot be invented. |
| [!] | **Extensions** `obj:/show/web/ext` | Native host relay exists; third-party browsing/CSP and cookie integration are absent and need a reviewed security design. |
| [!] | **WebXR** `obj:/show/web/webxr` | The owner explicitly deferred XR because hardware is unavailable; no XR implementation or acceptance environment exists. |
| [!] | **Cloud** `obj:/show/cloud` | Workers/storage/Terraform exist; full account reconstruction and multi-server API/hosting infrastructure are incomplete. |
| [?] | **Monolith** `obj:/show/cloud/mono` | The fixed system APIs use one Worker dispatcher; unit and workerd/D1 regressions pass. |
| [!] | **Microservices** `obj:/show/cloud/micro` | The hub still supports one agent; multiple server registrations and versioned API destination routing are absent. |
| [!] | **Infastructure as Code (IaC)** `obj:/show/cloud/iac` | Terraform is unavailable locally; clean-account Access/Tunnel provisioning and remote state are absent. Existing resources must be imported before apply. |
| [!] | **CI/CD** `obj:/show/cloud/cicd` | Branch-specific pipelines and staging infrastructure code exist; this revision has not been deployed or verified through the real blue/green release path. |
| [!] | **Security** `obj:/show/security` | JWT binding and sensitive-action revocation tests pass; optional WebAuthn/recent-login step-up and the stronger stated CSP policy remain incomplete. |
| [!] | **Content** `cmp:/content` | Content scanning works; scene vocabulary, pipeline desk extensions and several generated families remain incomplete. Content check still reports 39 warnings. |
| [!] | **Desk** `<desk>` `cmp:/content/page/desk` | Fixed-window desks now work; interactive maps, menu behaviors and several specified actions are incomplete. |
| [!] | **Map** `<map>` `cmp:/content/page/desk/menu/map` | Static map output exists; runtime pan/zoom, live resource nodes and consistent map/window toggling are absent. |
| [!] | **Node** `<node>` `cmp:/content/page/desk/menu/map/node` | Node markup exists; live node/window binding, selection synchronization and map interactions remain incomplete. |
| [!] | **Project** `<project>` `cmp:/content/project` | Project pages/research/Git access exist; contributor editing, public VFS mounts and complete source/package behavior are incomplete. |
| [?] | `collaborators` *(optional)* | The schema, declaration catalog and Git access checks carry normalized collaborator emails; the focused access regressions pass. |
| [!] | `confidental` *(optional)* | Git access and provider fallback restrictions are implemented, but the specified protected virtual project mount does not exist. |
| [!] | `repo` *(optional)* | Typed sources and Git fallback exist; npm/PyPI/package origin serving and verified non-Git fallback clients are absent. |
| [?] | **Pipeline** `<pipeline>` `cmp:/content/project/pipeline` | Branch/manual/named-hook triggers now enqueue exact commits. Shared parsing, real Git/queue and signed HTTP/replay tests pass. |
| [!] | `<menu>`, `<window>`, `<action>` | Pipeline schema accepts only steps; menu/window/action children and their runtime bindings are absent. |
| [!] | **Blog** `<blog>` `cmp:/content/blog` | Only Markdown/menu/window blog expansion exists. Scene schema, Canvas timeline, audio and encoding are absent. |
| [?] | **Theme** `<theme>` `cmp:/content/theme` | Existing themes, font generation and Material Design icon token mapping are implemented and tested; remaining artistic/device review is manual. |
| [!] | **Print** `<print>` `cmp:/content/print` | Selected print SCSS/fonts and the research layout work; arbitrary layouts, blog books and quotations remain incomplete. |
| [!] | Only published information is used: personal details come from the landing page's first `<hero>` (`name`, `profile`, `<item print="label">`), history from the expertise. Missing values print as empty boxes which can be editted (the user toggle print mode in dev tools, add the content, and then print), nothing is invented/placeholder. Dates/age are refreshed on `beforeprint`. | Published-data filtering exists, but structured profile/photo fields and every beforeprint/form variant still need acceptance against the current hero contract. |
| [!] | **Plugin** `<plugin>` `cmp:/content/plugin` | Existing plugin loading and split/edit/compare flows work; complete trigger/conversion graph, blog render plugins and map/resource integration are incomplete. |
| [!] | **Pipeline Script** `cmp:/src/pipeline` | All named stages now have entry points, including inst/ext/app; full cloud/server stage semantics depend on missing provisioning and roles. |
| [!] | `5` **Emulated** `host` | Worker/D1/static local emulation works; offline identity and personal-server parity are absent. Google OAuth still requires its provider. |
| [!] | `6` **Cloud** `cloud` | Read-only preflight and stable generated values now work. Write scopes, automatic Access/Tunnel resources, remote state and clean-account bootstrap remain incomplete. |
| [!] | `7` **Server** `server` | Repository/pipeline listener exists; role selectors, multi-server allocation, Tunnel bootstrap and isolated custom APIs are absent. |
| [!] | `9` **App** `app` | The Electron launch stage works and was smoke-tested; the specified i3/Sway/Hyprland integration and full native VFS are incomplete. |
| [!] | **Docker App** `cmp:/src/docker` | Existing container entry modes remain; separate role-aware server and desktop packaging are incomplete. No images were published or replaced. |
| [!] | **Routes** `cmp:/engine/routes` | Existing literal routes plus RSS/Atom have owners; page/assets/font/icon/cover families still bypass a complete dist-mirroring route registry. |
| [!] | **Extension** `cmp:/extension` | Packaging and native host tests pass, including ARM64 compiled PTYs; external browsing, reload reattachment and real kiosk acceptance remain incomplete. |
| [!] | **Filesystem** `cmp:/desk/fs` | OPFS/temp/kernel files work; public, Drive and collaboration mounts are absent. |
| [!] | **Personal** `cmp:/desk/fs/personal` | Drive is used for Work key files only. Visitor file storage, identity home paths, permission prompts and conflict copies are absent. |
| [!] | **Public** `cmp:/desk/fs/public` | Published HTTP resources exist, but no consistent /srv projects/events/blogs mount or authenticated persistent writeback exists. |
| [!] | **Collaboration** `cmp:/desk/fs/collab` | No authorized shared-folder protocol, account isolation, collaborator-home projection or conflict resolution exists. |
| [/] | **Submenu** `cmp:/desk/menu` | Public Version menus and maps work; dynamic windows/groups, private Work history and People menus remain incomplete. |
| [!] | **Chats** `cmp:/desk/menu/chat` | Encrypted Work chat exists; consistent chat menus and collaboration across arbitrary desk resources are incomplete. |
| [/] | **Windows** `cmp:/desk/menu/windows` | Live split tree, reversible hiding, comparison drops and map/tab synchronization work; persistent desktop groups remain open. |
| [/] | **Versions** `cmp:/desk/menu/version` | Public history, no-ff merge nesting, refs/tags and fixed graph work; private Work history, pagination and historical file browsing remain open. |
| [!] | **People** `cmp:/desk/menu/people` | People storage, region grants and graph projection are absent; the menu cannot safely expose nonexistent authorization. |
| [!] | **Notebook** `cmp:/desk/window/note` | Markdown reading works; editable notebooks, Jupyter cell execution and persistence are absent. |
| [!] | **AutoSite** `cmp:/desk/window/autosite` - | Existing AutoSite automation browser works; final owner/device interaction and the new API integration remain unverified/incomplete. |
| [!] | **AutoJS** `cmp:/desk/window/autojs` - | Existing automation scripts work; isolated script-per-process custom API deployment and its desk controls are absent. |
| [!] | **Specific** `cmp:/desk/action/specific` | Existing controls work; resource comments, the specified volume interactions and complete save destinations remain incomplete. |
| [!] | **Volume** | Some media audio controls exist; consistent per-window mute/range behavior across server/media views and touch is incomplete. |
| [!] | **Chats** | Work messaging exists, but selections/annotations and resource-bound comment threads are absent. |
| [!] | **Save** | Saving existing writable files works; destination selection/persistent save for new or read-only resources is incomplete. |
| [!] | **General** `cmp:/desk/action/general` | Fixed desks now block layout changes; complete auto/fixed control visibility and all remaining general actions need review. |
| [!] | **Fullscreen** | Maximizing exists; full media-specific hover/touch header and fullscreen presentation behavior are not fully verified. |
| [!] | **Split** | Split editors/compare/image-to-PDF work; arbitrary MIME convert/compare/mirror graph search is incomplete. |
| [!] | **Drag/Move** | Existing drag/dock and fixed/auto movement guards work; every portrait/touch/menu interaction still needs acceptance. |
| [!] | **Projects** `cmp:/projects` | Project rendering, research printing and Git access exist; authenticated editing and repository filesystem remain incomplete. |
| [!] | **Git Repo** `cmp:/projects/git` | Smart HTTP and collaborator tokens pass regressions; authenticated desktop editing and live project snapshots remain incomplete. |
| [?] | **Research Paper** `cmp:/projects/paper` | Named research layout and project opt-in render ordered public research with nested points, print geometry and language/privacy isolation; Chrome/PDF and focused contracts pass. |
| [!] | **Blogs** `cmp:/blogs` | Blog pages and subscriptions work; scenes, owner management, video render and book print remain absent. |
| [!] | **Media Generation** `cmp:/blogs/gen` | No pure-time Canvas scene renderer, deterministic assets/audio mix, offline WebCodecs encoding or export UI exists. |
| [!] | **Book** `cmp:/blogs/book` | No book pagination, layout template or blog print integration exists. |
| [!] | **Server** `cmp:/server` | Current agent, repository and automation browser work; role-aware multi-server routing and the new API process model are absent. |
| [!] | **Roles** `cmp:/server/role` | No role table/selectors, exclusive People lease or overlay server registration exists. |
| [!] | **Network** `cmp:/server/net` | No per-server network mounts, per-terminal switchnet/onnet or logical union resolution exists. |
| [!] | **Repository Hub** `cmp:/server/repo` | Git is implemented; personal-server OCI and Linux/library package backends are absent. |
| [!] | **Container Registry** `cmp:/server/repo/docker` | Current OCI pulls use the cloud R2 registry. There is no Tunnel-first personal-server OCI storage/backend or verified cutover. |
| [?] | **Reserved IDs** | One shared DNS-ID rule reserves apt/dnf/npm/pypi and version/service labels; schema and repository access tests cover rejection. |
| [?] | **Pipelines** `cmp:/server/pipeline` | Named owner hooks now complement branch/manual triggers and queue immutable tips; signed HTTP/replay and real Git tests pass. |
| [!] | **Custom APIs** `cmp:/server/api` | The old in-process API prototype remains. The referenced APISERVER.md is absent; versioned child processes, stores, manifests and server-owned auth/rate/schema enforcement are not implemented. |
| [!] | **App** `cmp:/app` | Independent Electron desk and shared native terminal IPC are implemented; compositor placement, native VFS and full IO integration are incomplete. |
| [!] | **Window Manager** `cmp:/app/wm` | No X11/i3/Sway/Hyprland window discovery/placement backend or desk-native window projection exists. |
| [!] | **Input / Audio / Clipboard / Terminal** `cmp:/app/io` | Compiled native PTYs passed on ARM64; native filesystem, global input and full audio/clipboard integration remain incomplete. |
| [!] | **Work** `cmp:/work` | Encrypted messaging works; client codebase mounts, project collaboration and personal-server website hosting remain incomplete. |
| [!] | **Configurations** `cmp:/config` | Public configuration and private inputs exist; multi-server/work namespace configuration and complete account bootstrap remain incomplete. |
| [!] | **Private** `{codebase}/.env` | Generated values are preserved and read probes run before cloud deployment; complete write-scope/Tunnel/Access provisioning is absent. |
| [!] | **Required, manual (checked before the cloud step)** | Presence/format/account/zone/service-read checks are implemented. Read probes cannot prove edit permissions; Google console settings and Terraform write scopes still need validation. |
| [!] | **Generated after setup, written back** | Account/zone/admin email, VAPID pair and JWT secret persist without overwrite; Access service-token/Tunnel outputs and complete bucket-output persistence are absent. |
| [!] | **People** `cmp:/people` | No People vCard datastore, graph, region-grant authorization, account binding or protected page exists. |
| [!] | **Cloud** `cmp:/cloud` | Existing Worker/storage/infrastructure code works; the multi-server hub, versioned gateway and clean-account provisioning remain incomplete. |
| [!] | **Router** `cmp:/cloud/router` | Current host/assets/API routing works; shared work/project allocation and personal-server work hosting are absent. |
| [!] | **Hub** `cmp:/cloud/hub` | The current Server_Hub accepts a single agent. Role-aware registration, exclusive leases and multi-server dispatch are absent. |
| [!] | **Gateway** `cmp:/cloud/gateway` | Only the legacy gateway prototype exists; versioned manifest matching, child-process ownership and the specified server-side enforcement are absent. |
| [!] | **Repository Front** `cmp:/cloud/repo` | Tunnel-first Git and cloud OCI work; Linux/library backends, all fallback clients and real domain cutover are incomplete. |
| [!] | **System APIs** `cmp:/cloud/api` | Session/work/auth/server/push/projects endpoints exist; the Clients API and remaining management contracts are absent. |
| [!] | **Domains** | Project redirects and existing host routing work; People/work hosting and repository cutover still need implementation/deployment. |
| [!] | **Staging Domain** `staging.jasouza.com` | Staging infrastructure code and a running staging container exist; the new revision has not passed a live staging release and rollback check. |
| [!] | **Work Website** `{work id}.jasouza.com` | No personal-server client-site registry, shared work/project ID allocation or signed work-host proxy exists. |
| [!] | **Subdomain IDs** | Shared syntax/reserved-ID checks exist; atomic project/work allocation across authoring and live D1/KV registration is absent. |
| [!] | **Repository** `repo.jasouza.com` | Repository-host Git/cloud OCI code exists; DNS/Terraform cutover and personal package backends remain incomplete. |
| [!] | **Linux** | No apt Packages/Release signatures or DNF repodata/package serving backend exists. Built package artifacts and signing-key ownership are required. |
| [!] | **Libraries** | No npm/PyPI registry metadata, tarball/wheel upload serving, Deno module or Go discovery backend exists. |
| [!] | **People** `ppl.jasouza.com` | No protected People application, verified alias registry or corresponding host redirect is implemented. |
| [!] | **Emails** | Mail forwarding/assistant delivery are not provisioned; destinations and ownership verification must be supplied by the operator. |
| [!] | **Owner** `jason@jasouza.com` - | No mail delivery/DNS acceptance check was performed. Preserve existing mail configuration; the owner's verified destination is required for routing changes. |
| [!] | **Assistant** `eva@jasouza.com` | No Eva assistant service or verified receiving/sending identity exists; model/runtime and mail credentials are operator inputs. |
| [!] | **Known People** `{username}@ppl.jasouza.com` | People region grants and verified forwarding destinations are absent; do not route mail to guessed recipients. |
| [!] | **Routing** | Existing routing works; work-site namespace allocation, People routing and multi-server hosting are incomplete. |
| [!] | **Work** | The external HTTPS Work proxy is not personal-server client hosting; its shared allocation and host selection are absent. |
| [!] | **Clients** `clients` - | No fixed Clients CRUD API or complete authorized management contract exists. |
| [!] | **Custom API** | The legacy prototype is not the requested /api/{id}/v{n} child-process platform; keep unknown requests fail-closed. |
| [!] | **Data Storage** - | Existing D1/KV/R2/DO/browser storage works; People, collaboration, native mounts and Drive visitor storage are incomplete. |
| [!] | **Personal Server** | Repository state persists on the server; role-owned People/custom-service persistence and unified mounts are absent. |
| [!] | **Drive** | Encrypted Work key storage exists; account Drive filesystem mounts and file sync/conflict handling are absent. |

## Final checklist totals

`COMPONENTS.md` now contains 329 `[?]` review-ready entries and 132 `[!]` issues/notices, with no unchecked, in-progress or AI-accepted entries. All 461 owner-authored checkbox descriptions are preserved (status changes and trailing whitespace normalization only). Of the 140 originally unchecked/in-progress entries, implemented changes are documented above; large missing systems remain explicit issues rather than false completion claims.
