# Cloud: Pages, Worker, API, data stores and security

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/node/worker.ts`, `src/node/deploy.ts`, `src/node/security.ts`, `src/node/d1_migrate.ts`, `terraform/`, `migrations/`, `wrangler.local.jsonc`
- **Related guides:** [docs/src/node.md](../src/node.md), [docs/infra.md](../infra.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Terraform infrastructure (Pages, Worker, R2, KV, D1, routes) replacing Wrangler provisioning, plus dry-run staging (4.1–4.2)
  - [ ] Validate `terraform validate/plan/apply` against a real account and import existing resources
- [x] Central routing: project redirects, registry subdomains, assets, API, work shell and Pages fallback
- [x] Public health API; unimplemented private resources fail closed (4.3)
- [x] Large media split to R2 with range support; small hashed media stays on Pages
- [x] D1 schema/migration and local R2/KV binding configuration
- [ ] Headers/CSP, attachment policy and deployment security regression tests (4.7)
- [ ] Email Routing, analytics, Search Console, monthly rebuild and owner-controlled delivery (4.9)
- [ ] Remote Terraform state backend for multi-machine deploys

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 4. Cloud and IoT (`{codebase}/src/node`)

The compiled scripts here run on cloud nodes: the Cloudflare Worker, Pages, and the owner's personal server. The domain is the owner's (for example `jasouza.com`); Cloudflare provides hosting, storage, database, mail and zero trust.

## 4.1 Static hosting

**Objective.** The website keeps working even if every owner-run server is offline.

**Solution.** `dist` is generated beforehand and hosted on Cloudflare Pages, a static host with no server to maintain. Heavy files (media, WASM, shared files) are in Cloudflare object storage (R2) and reached through the Worker.

## 4.2 Dynamic routing (central Worker)

**Objective.** Add capabilities beyond static files without disturbing existing routes, and make routing configurable.

**Solution.** One Worker bound to `{domain}/*` and `*.{domain}/*`. Static files are served by Pages; the Worker handles the rest in this order: subdomain rules, `/assets`, `/api`, `/work` shell, everything else to Pages. Pages that are dynamic yet need SEO and are not user specific can be routed to another server. Unassigned subdomains show the normal empty page.

| Match | Action |
|---|---|
| `{app}.{domain}` where `app` is a project | `301` to `/projects/{app}` (the same content is never served from two hosts, so search engines do not flag duplicates) |
| `{name}-demo.{domain}` | Proxy to the demo server registered for that name (configurable without redeploying) |
| `{name}-work.{domain}` | Proxy to the personal server hosting that client's website |
| other subdomain | Empty page, `404` |
| `/assets/*` | Object storage with long caching for hashed names, correct `Content-Type` (WASM needs `application/wasm`) and CORS |
| `/api/*` | API forwarding (4.3) |
| `/work` | The work shell (a single static page), `Referrer-Policy: no-referrer`, `noindex` |

Subdomains are capped at two levels because free Cloudflare certificates do not cover deeper ones, so a hyphen replaces the second dot (`*-demo`, `*-work`).

## 4.3 API forwarding

**Objective.** One uniform JSON API in front of many servers, so APIs can be added or moved without breaking clients.

**Solution.** Path `/api/{version}/{resource}/{id}/{subresource}?{query}`, for example `/api/v1/clients/123/receipts?status=pending&sort=desc`. Resource names are plural; the query never identifies a resource. The Worker keeps a table from resource to backend, checks authentication and rate limits, and calls the backend adapter (database, object storage, durable object, or the personal server). Errors are `{ "error": { "code", "message" } }` with the matching HTTP status. Responses are `no-store` except versioned public reads. When the personal server is unreachable the response is `503` with the latest cached snapshot and `stale_since`. Calls to the personal server carry an HMAC-signed header (timestamp, client id, body hash) so it trusts only the Worker.

| Resource | Backend | Access |
|---|---|---|
| `auth` | Worker (token verify, session cookie) | public, creates a session |
| `session` | Worker and database | session |
| `clients` | Database | admin |
| `messages` | Database and durable object | session or admin |
| `files` | Object storage and database index | session or admin |
| `receipts` | Database | session (own) or admin |
| `desk_state` | Database | session (own) or admin |
| `dashboards` | Personal server with cached snapshot | session (own) or admin |
| `git` | Personal server | public for public projects, admin for private |
| `health` | Worker | public |

Rate limits (adjustable): authentication 10/min per IP, claim 20/min per IP, messages 60/min per client, files 20/hour per client.

## 4.4 Data stores

| Store | Holds |
|---|---|
| Static `dist` | Pages, JSON, CSS, scripts, fonts, SEO files, home manifest |
| D1 (SQL) | `clients` (id, uuid hash, slug, name, icon, google subject, email), `device_sessions` (hashed token, label, last seen, revoked), `messages` (client, idempotency id, author, kind `text`/`file`/`dashboard`/`receipt`/`pin`, body, ref, soft delete), `files` (R2 key, name, mime, size, hash), `receipts` (code, provider, amount in minor units, currency, status `paid`/`pending`, note, dates), `pins` (message, window JSON, position), `dashboards` (name, source path, last snapshot), `desk_state` (per client and owner, JSON, version), `admin_audit` |
| R2 (objects) | `clients/{client_id}/files/{file_id}`, `wasm/{plugin_id}/{version}/...`, `media/{hash}.{ext}`, `srv/{blogs|events}/{id}/{path}`, `backups/d1/{date}.sql` |
| KV | Demo registry, feature flags, dashboard snapshots, rate-limit counters |
| Durable object | One chat room per client: sockets and last event id (state rebuildable from the database) |
| Personal server | Git repositories, custom services |
| Browser | File system, WASM cache, preferences; never uploaded |
| Google Drive | Signed-in visitors' desk files and state; owned by them |

IDs are sortable ULIDs; the client UUID (v4) is the QR secret. Timestamps are Unix seconds.

## 4.7 Security

| Area | Rule |
|---|---|
| Headers | HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on `/work`), minimal `Permissions-Policy`, `frame-ancestors 'none'` |
| CSP | `default-src 'self'`; scripts `'self'`, `'wasm-unsafe-eval'` and the hash of the boot script; styles `'self'` with inline style attributes only for generated custom properties; images `'self' data:`; fonts `'self'`; connections `'self'` plus Google domains; frames only for Google sign-in |
| Uploads | Size caps, mime sniffing, random storage keys, downloads as attachments except images |
| XSS | Messages are text; markdown renders with HTML disabled; only first-party scripts |
| Isolation | Cross-origin isolation is off; if threaded WASM is needed it is enabled for desk paths only |
| Secrets | Cloudflare secrets only; never in the repository |

## 4.9 Mail, analytics and delivery

- **Email**: Cloudflare Email Routing forwards `{name}@{domain}` addresses to a private mailbox, protecting it from spam; notices to the owner use the Worker's send binding.
- **Analytics**: cookieless Cloudflare Web Analytics and zone analytics, plus Google Search Console. No analytics that needs a consent wall.
- **Delivery**: a push to the main branch runs check, build (cache restored), tests, then deploys Pages, the Worker and database migrations; a monthly schedule rebuilds so "present" dates stay current.
