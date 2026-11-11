# Personal server

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/node/personal.ts`, `src/node/security.ts`
- **Related guides:** [docs/src/node.md](../src/node.md), [README → Server Use](../../README.md#server-use)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] HMAC origin verification, replay bounds and Access service-token forwarding (4.8)
- [x] Explicitly allow-listed public Git refs/tree/blob/log read adapters
- [x] Loopback-only listener; unsigned requests (including `/health`) return `401`
- [ ] Owner: provision Cloudflare Access/Tunnel and operate the node
- [x] Native Git push transport with per-user tokens, roles and archived projects (tested end to end with real git through `route()` + node; not yet on a real Tunnel/Access)
- [x] Static git mirror for `git clone {domain}/projects/{id}.git` served by Pages (dumb HTTP; tested with a real clone against a local static server)
- [ ] Verified on the real Cloudflare Worker/Tunnel/Access/Pages (push size limits, auth challenge pass-through, Pages serving `info/refs`)
- [ ] Dashboard snapshots (`GET /dashboards/{client}/{name}`)
- [x] CI/CD pipeline for `jazu`: tests gate the build, deploy only when the output changed (pipeline tested with fake steps; failing CI blocks deploy)
- [ ] Real run of `npm run types` / `npm test` / `npm run check` / `wrangler pages deploy` on the server (needs `npm ci`, credentials)
- [ ] Per-project pipelines for the archived projects (intentionally not built)
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
