# Generation 12 tasks

Ordered dependency checklist. `[x]` means implemented and verified, `[ ]` means still in development, and `- [ ] ~~...~~` means cancelled or replaced with the stated reason. Component numbers refer to `COMPONENTS.md`. A checked parent requires every necessary child to be checked. This file intentionally records the entire architecture, not only the migration diff.

## 1. Import and establish a runnable root

- [x] Keep all work on `migration/gen-11-to-gen12`; preserve gen-11 as an ignored reference.
- [x] Copy the engine, content, themes and helpers without .env, Git history, caches or dependencies.
- [x] Move CLI to `src/main.ts`, generators to `src/web`, browser runtime to `src/web/client`, local server to `src/node` (5).
- [x] Rename internal events, module names, CLI and browser storage identifiers to `jazu`.
- [x] Add reproducible npm installation, type checking and root build commands.
- [x] Create README, COMPONENTS, PLACEHOLDER and ordered TASKS documents.

## 2. Content contracts and generation

- [x] Scan XML recursively anywhere below content and parse multiple strict XML roots (1.0, 2.2).
- [x] Read owner settings and append-only icon registry from config.json (1.12).
- [x] Migrate authored landing/contact sections to hero/item and side to menu (1.2, 1.4).
- [x] Generate project, event and blog pages and project/blog listings from roots (1.5–1.7).
- [x] Exclude private projects/slides from generated public resources and pages.
- [x] Derive expertise events from root objects; retain declared skill/stack vocabulary (1.3).
- [ ] Finish skill-specific slideshow behavior.
  - [x] Select per-skill project slides and a featured fallback.
  - [ ] Deduplicate search results across variants and rank the best matching slide.
  - [ ] Support skill/stack radio filtering without :has and version fragments.
  - [ ] Respect nested skill stacks and report undeclared vocabulary consistently.
- [ ] Complete desk content extensions (1.4).
  - [x] Preserve static entries/windows and pre-render Markdown/code.
  - [x] Render menu foot actions and static map fallback links.
  - [ ] Add map/window toggling, pan and zoom.
  - [ ] Load repository Files/Version snapshots and contributor-only Agent menus.
- [x] Select root print modes by language; use published hero data only (1.13).
- [x] Verify exact/prefix/wildcard print-language selection.
- [ ] Complete arbitrary print layouts, fonts and quotation runtime.
- [x] Publish only referenced XML media/window resources (1.14).
- [ ] Complete transitive Markdown/HTML resource discovery and collision-safe nested relative publication.
- [x] Preserve translations, theme compilation, custom fonts, SEO, SPA payloads and no-JavaScript HTML.
- [ ] Complete skeleton theme, shared fixed canvas/slots and theme lifecycle contract (1.9, 2.4).
  - [x] Inline shared geometry and mode-aware shimmer; load named themes without blocking first paint, with readable no-JavaScript and failure fallbacks.
  - [x] Diagonal SPA wipes through skeletons, preserve the signature node, and isolate named skins with rollback on failed theme changes.
  - [ ] Replace the legacy theme background trees/renderers with the shared fixed canvas/slots contract.
- [ ] Implement full plugin trigger/flow/WASM pipeline (1.10, 2.10).
  - [x] Validate plugin declarations and require WASM SHA-256 metadata.
  - [ ] Publish scripts/WASM manifests and verify bytes before execution.
  - [ ] Move built-in viewers/converters/processes to declared plugins.

## 3. Engine integrity and developer commands

- [x] Preserve incremental output hashing, generated assets and dependency graph.
- [x] Pin generated font timestamps so unchanged builds write zero files and skip all 68 pages.
- [x] Prevent stale outputs and SPA payloads after deletes, renames and visibility changes.
- [x] Cover generator/body/resource/date/source changes in cache invalidation.
- [ ] Implement timestamp/manifest/HEAD incremental source parsing and repository revisions (2.3).
- [ ] Replace string renderers with shared safe vnode to_html/to_dom primitives (2.4).
- [x] Port existing monochrome/COLRv0 fonts to TypeScript with native Node compression (2.6).
  - [x] Independently decode TTF, WOFF, WOFF2, COLR and CPAL; verify BMP/astral mappings, metrics and reproducibility.
- [ ] ~~Retain the Python font compiler.~~ Superseded by the owner’s Node-only requirement; TypeScript now covers the formats in use.
- [x] Remove obsolete Python batch icon assembly scripts; preserve all published authored outlines in theme XML.
- [ ] Complete main.ts command surface (2.1).
  - [x] build/check/serve/watch/clean/icons/graph/pack.
  - [x] Safe clean/output-root validation.
  - [x] Watch content/config and serialize rebuilds; report that engine changes need restart.
  - [x] Dry-run deployment staging.
  - [ ] new/theme/font/only/graph-format support.
- [ ] Isolate filesystem/process IO behind runtime adapters; engine remains Node-based during migration.

## 4. Browser runtime

- [x] Preserve SPA navigation, search, themes, preferences and header menus (3.1–3.4).
- [x] Preserve desk windows, layout, resizing, syntax, shell, processes and visitor OPFS home (3.5, 3.7).
- [x] Replace the JavaScript shell/utilities with compiled BusyBox ash and applets; use Worker processes, shared byte filesystem calls, inherited descriptors, pipes, fork/exec/wait and local xterm.js. Build recipes and scope are in `src/desk/README.md`.
- [x] Keep uploads strictly in memory; remove inherited OPFS /tmp behavior.
- [ ] Offer a destination picker on Save for new/read-only windows.
- [ ] Mount public /srv resources consistently in browser VFS and desk window loading.
- [ ] Complete plugin flow graph, MIME conversions, map resources and hidden processes (3.5–3.6).
- [ ] Google Drive visitor storage, in-memory tokens and conflict copies (3.8).
- [ ] Work client sessions, messages, pins, receipts, dashboards and state versioning (3.9).
- [x] Preserve beforeprint date/age refresh (3.10).

## 5. Cloud and personal nodes

- [x] Pages and Worker Wrangler configurations plus local/dry-run deployment validation (4.1–4.2).
- [x] Central routing: project redirects, registry subdomains, assets/API/work and Pages fallback.
- [x] Public health API; fail closed on unimplemented private resources (4.3).
- [ ] Complete cloud data stores (4.4).
  - [x] D1 schema/migration and local R2/KV binding configuration.
  - [ ] Per-client durable chat and database API adapters.
- [ ] Google JWT verification, UUID claim, hashed cookie sessions, tenant filtering, CSRF and rate limits (4.5).
- [ ] Chat idempotency/reconnect/soft deletion, file upload policy, owner audit and mail debounce (4.6).
- [x] HMAC origin verification, replay bounds and Access service-token forwarding (4.8).
- [ ] Owner: provision Access/Tunnel and operate the personal node.
- [x] Explicitly allow-listed public Git refs/tree/blob/log read adapters.
- [ ] Native Git transport, authorized pushes, dashboard snapshots, live rebuild/CI and agents.
- [ ] Headers/CSP, attachment policy and deployment security regression tests (4.7).
- [ ] Email Routing, analytics, Search Console, monthly rebuild and owner-controlled delivery (4.9).

## 6. Validation and owner review

- [x] Run TypeScript checking and the migrated content validator.
- [x] Add contract regression tests for privacy, resources, cache, CLI and routes.
- [x] Run production build, repeated pinned-date build and local HTTP smoke checks.
- [x] Validate Worker bundles and migration SQL locally without production credentials.
- [x] Document test evidence, known limitations, placeholders and deployment commands.
- [x] Commit each validated state with Conventional Commits; leave branch ready for owner review.
- [ ] Owner: restore/verify assets and public wording; provision cloud resources and complete unfinished service tasks.
- [ ] Owner: analyze and monitor the migration, then merge to master manually.

## Header and translation finalization

- [x] Combine English/Japanese page and blog roots into one XML file per authored page/blog, retaining language routes and relative resources.
- [x] Add optional hero `tab` label override; keep the visible owner name and set landing tabs to Home / ホーム.
- [x] Align desktop header tabs to the right with flexible space after breadcrumbs.
- [x] Place the header separator between the head tabs and account button, accounting for right-to-left dropdown direction.
- [x] Verify shared-file language variants, rendered tab labels and header control order in regression tests.

## Validation evidence

- TypeScript checks cover source and tests; 22 regression tests pass.
- 68 HTML routes respond correctly (including the generated 404).
- An unchanged pinned-date build skips 68/68 pages and writes no files.
- Local Wrangler: health 200, Pages fallback 200, Work shell 200 with no-referrer/no-store, unfinished messages API 501.
- Local R2: `bytes=0-2` returns 206, `Content-Range: bytes 0-2/10`, and the expected three bytes.
- Local D1 migration applies successfully; tests enforce idempotency and cross-tenant pin constraints.
- Worker dry-run bundles successfully; staging separates six videos for R2 and excludes stray dist files.
- Browser: portfolio, media and desk render; desk console has no errors; Contact navigation targets #contact.
- Content check succeeds with 39 documented owner/editorial warnings; strict mode is intentionally not clean.
- No cloud deployment or merge to master has occurred.
