# Personal server

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/node/personal.ts`, `src/node/security.ts`
- **Related guides:** [docs/src/node.md](../src/node.md), [README → Server Use](../../README.md#server-use)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Provider-independent per-project `repo` synchronization and XML `<pipeline>` commands, isolated branches/state, loop prevention and CI-gated export (real Git integration tests)
- [x] Fresh-process catalogs and exact-commit engine workers; idle listener restart on runtime updates (four real Git/process regressions, including service exit 75)
- [x] Project-independent branch pipelines for staging, one shared deployment checkout, separate sync/publication state and primary mirror protection (real Git/process and publication tests)
- [x] Standalone staging Terraform automation for Pages/R2, DNS/domain, Worker routing and existing secret bindings (provider validation and mocked resource tests)
- [ ] Provision and verify `staging.jasouza.com` after merging to master ([setup](../infra-staging.md))
- [x] Activate and verify XML project pipelines/repository sync on the production Pi after review and commit (2026-11-12, `8d39520`; 157 tests passed, upstream synchronized, Pages/R2 deployed; job `1794453724599_16490bb4`)
- [x] HMAC origin verification, replay bounds and Access service-token forwarding (4.8)
- [x] Explicitly allow-listed public Git refs/tree/blob/log read adapters
- [x] Loopback-only listener; unsigned requests (including `/health`) return `401`
- [x] Owner: provision Cloudflare Access/Tunnel and operate the node
- [x] Native Git push transport with per-user tokens, roles and archived projects (tested end to end with real git through `route()` + node; not yet on a real Tunnel/Access)
- [x] Static git mirror for `git clone {domain}/projects/{id}` (also `.git`) served by Pages plus R2 for oversized packs (verified with a real production clone)
- [x] Verified on the real Worker/Tunnel/Access/Pages/R2: authenticated push, 401 challenge, static refs and a fresh public clone
- [ ] Test pushes approaching the Cloudflare plan request-size limit
- [ ] Dashboard snapshots (`GET /dashboards/{client}/{name}`)
- [x] CI/CD pipeline for `jazu`: tests gate the build, deploy only when the output changed (pipeline tested with fake steps; failing CI blocks deploy)
- [x] Real run of types/tests/check/build, R2 uploads and `wrangler pages deploy` on the Pi: 136 tests passed, none skipped
- [x] Generic project CI/build/deploy pipelines declared in XML; undeclared repositories remain archived
- [ ] AI agents with repository access
- [x] Contributor authentication (tokens) and private-repository clone via the node (tested)
- [ ] SSH access to the repository hub (not built)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 4.8 Personal server

**Objective.** Own the development workflow: repositories, builds, agents and live dashboards, without making the public website depend on them.

**Solution.** The same `main.ts`, running on the owner's machine (using ElectronJS as a virtual browser where needed), reached through Cloudflare Tunnel and zero trust. It provides:

- **Live build and push** to Pages.
- **Repository hub** for `/projects` (public or private) and `/work` (client, private): anyone can `git clone {domain}/projects/calculator` unless the project is private; clients push to their own repository; partners collaborate on projects; ssh to the domain is possible. Public project content is in the static website; private content and pushes go through the Worker to the server.
- **Custom CI/CD** and **AI agents** for complete development capability.
- **Desk integration**: a project's repository (`repo`, e.g. `~/repo/linux_remake`) is `/srv/repo/{id}` and appears in the `Files` tab, its history in `Version`, the agents' conversation in `Agent` (contributors only), the server status in a map. The engine watches these repositories and applies their changes unless the project is `private`.
- **Origin contract** (all requests HMAC signed): `GET /git/{project}/refs`, `/tree/{ref}/{path}`, `/blob/{ref}/{path}`, `/log/{ref}`; `GET /dashboards/{client}/{name}` returning widgets `{title, kind, data, updated_at}`; `GET /health`.

If the server goes down, git pull and push stop and live dashboards show their last snapshot, but the website, messages and receipts keep working.


## Production verification — 2026-11-12

Functional commit `5c7fcfaf3ca20fa1830ec7c77af45acb5e5cd815` was pushed over authenticated HTTPS to `https://jasouza.com/projects/jazu`. The post-receive hook queued CI/CD; all 136 tests passed on the ARM Pi with no skips, content validation completed, and Pages deployment succeeded. An earlier test timeout failed CI and correctly prevented deployment. The website serves from `jazu-1ws.pages.dev` through `jazu_router`; the origin is protected by Access and the existing Cloudflare Tunnel.

A fresh, unauthenticated clone from the extensionless production URL checked out `master` at that exact commit and passed `git fsck --connectivity-only --no-dangling`. Static refs returned 200, unsigned push discovery returned 401, and an oversized R2 pack returned 206 with its `PACK` magic for bytes 0–3. The homepage SHA-256 matched the Pi's generated `dist/index.html` byte for byte. `/api` returned JSON discovery and `/api/v1/git/jazu/blob?path=package.json` returned the repository resource.

The node stayed running during the production clone: automatic approval review rejected the proposed service-stop test with `blocked by policy`. Node-independent clone routing is verified by tests that omit the personal origin, including R2 range requests. Do not describe a real shutdown test as completed.

The server checkout remains on `feature/personal-server`; the public bare repository deploys `master`. The owner uses `git push personal HEAD:master` from the development checkout, or `git push origin master` from a fresh website clone. Operator state is outside Git; collaborator changes require restarting the node. Worker updates use `wrangler.production.jsonc`, independently of the Pages-only push pipeline.
