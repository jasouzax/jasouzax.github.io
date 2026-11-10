# Nodes (`src/node`)

Code that runs on a *node* of the system: your machine's local server, the Cloudflare Worker, the personal server, and the deploy tooling. Back to [site developer guide](README.md). Status: [cloud](../feat/cloud.md), [personal server](../feat/personal_server.md), [work](../feat/work.md). Infrastructure: [../infra.md](../infra.md).

| File | Runs on | Responsibility |
|---|---|---|
| `serve.ts` | Your machine | Static server for `dist/` on `127.0.0.1`: path safety, `_headers` application, 404 page, `/work` headers |
| `worker.ts` | Cloudflare Worker (`{domain}/*`, `*.{domain}/*`) | Central router |
| `security.ts` | Worker + personal node | Security headers, API error shape, HMAC sign/verify |
| `personal.ts` | Personal server | Signed read-only Git adapter + health |
| `deploy.ts` | Deploy machine | Stage `dist`, bundle Worker, run Terraform and the Pages upload |
| `d1_migrate.ts` | Deploy machine (called by Terraform) | Apply `migrations/*.sql` through the D1 HTTP API |

## Local server (`serve.ts`)

`serve(out, port)` listens on **127.0.0.1 only**. `resolve_request()` rejects `\`, NUL, `..` and dot-segments, maps `/x` to `x/index.html`, and applies `dist/_headers` (so CSP and COOP/COEP behave as in production). `/work` additionally gets `no-referrer`, `noindex`, `no-store`. Missing files return `dist/404.html` with status 404.

## Central Worker (`worker.ts`)

`route(request, env, upstream)` order:

1. Reject invalid percent-encoding, `\`, NUL, `..` and dot-segments (except `/.well-known/security.txt`).
2. **Host rules** (when the host is not `DOMAIN`/localhost):
   - `{project}.{domain}` where `{project}` is in `PUBLIC_PROJECTS` → `301` to `https://{domain}/projects/{project}`.
   - `{name}-demo.{domain}` / `{name}-work.{domain}` → proxy to the **explicit HTTPS origin** stored in KV key `host:{name}-demo|work`. Origins on the same domain are refused (would loop); cookies/auth are never forwarded.
   - anything else → 404.
3. `/api/*`:
   - `GET /api/v1/health` → `{ status: "ok", generation: 12, services: { work: "not_implemented" } }`.
   - `GET /api/v1/git/{public_id}/{refs|tree|blob|log}` for ids in `PUBLIC_PROJECTS` → signed request to `PERSONAL_ORIGIN` (HMAC headers + optional `CF-Access-Client-Id/Secret`), 10 s timeout, redirects refused. Failures → `503` (`origin_offline`).
   - everything else → `501 not_implemented` (fail closed; no client data accepted).
4. Non-GET/HEAD → `405`.
5. `/assets/media/*`, `/assets/wasm/*` → R2 (`ASSETS`) with range/conditional support, long immutable caching, `application/wasm` type, CORS for the site origin; fall through to Pages if the object is missing.
6. Everything else → Pages (`PAGES_ORIGIN`, must be a distinct HTTPS origin or 127.0.0.1) forwarding only `accept`, `accept-encoding`, `range`, `if-none-match`, `if-modified-since`.

`export default { fetch }` wraps every response with `secure_response` (nosniff, HSTS, referrer policy, permissions policy, `X-Frame-Options: DENY`; `/work` gets `no-referrer`, `noindex`, `no-store`).

Bindings/vars (`worker_env`): `DOMAIN`, `PAGES_ORIGIN`, `PUBLIC_PROJECTS` (JSON array of ids), `PERSONAL_ORIGIN`, secrets `ORIGIN_HMAC_SECRET`, `ACCESS_CLIENT_ID`, `ACCESS_CLIENT_SECRET`; `ASSETS` (R2), `REGISTRY` (KV), `DB` (D1, schema only for now).

**Adding an API:** add a branch before the `501` fallback in `route()`, keep errors in the `{ error: { code, message } }` shape via `api_error`, validate method and input, and add a test in `tests/nodes.test.ts`.

## <a id="personal-node"></a>Personal node (`personal.ts`, `security.ts`)

Start: `npm run node -- --port 8788` (`node --env-file=.env src/main.ts node`). Environment:

| Variable | Meaning |
|---|---|
| `ORIGIN_HMAC_SECRET` | ≥ 32 chars, else the node refuses to start |
| `JAZU_REPOSITORIES_JSON` | `{ "public_id": "/path/to/repo" }` — only **public** projects; never a private/client repository |

Contract (all requests must be signed GETs; `401` otherwise, including `/health`):

| Route | Result |
|---|---|
| `GET /health` | `{ status: "ok", generation: 12 }` |
| `GET /git/{id}/refs` | branches and tags with hashes |
| `GET /git/{id}/tree?ref=HEAD&path=dir` | `git ls-tree` entries |
| `GET /git/{id}/blob?ref=HEAD&path=file` | bytes (≤ 16 MiB) |
| `GET /git/{id}/log?ref=HEAD&path=…` | up to 100 commits |

`ref` must match `^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$` without `..`; `path` may not be absolute, contain `\`, NUL or `..` segments. Git is invoked with `execFileSync("git", ["-C", repo, …fixed args])` — no arbitrary commands.

**HMAC** (`sign_origin`/`verify_origin`): signs `METHOD\npath+query\ntimestamp\nnonce\nclient\nSHA256(body)`. Headers `x-jazu-time`, `x-jazu-nonce`, `x-jazu-client`, `x-jazu-signature`. Window ±60 s; nonces are remembered for 120 s to refuse replay.

The node binds loopback; reach it with a Cloudflare Tunnel protected by an Access service-token policy ([../../README.md#server-use](../../README.md#server-use)). If it is offline the public Git API returns 503 and everything else keeps working.

## <a id="deploy"></a>Deploy (`deploy.ts`)

`deploy(root, out, result, target, dry_run)`:

1. `load_env()` loads `.env` (shell variables win) and maps `ORIGIN_HMAC_SECRET`/`ACCESS_CLIENT_ID`/`ACCESS_CLIENT_SECRET` to `TF_VAR_*`.
2. `prepare_deploy()` creates `.cache/deploy/<stamp>/`: copies every file listed in `dist/.jazu_output.json` into `pages/`, **except files > 25 MiB**, which must live under `assets/media/` or `assets/wasm/` and are queued for R2; bundles `worker.ts` with esbuild (single ES module); writes `deploy.auto.tfvars.json` (worker name, pages project, domain, public project ids, personal origin, bundle path, large assets) and `uploads.json`; refreshes `.cache/deploy/latest.json`.
3. `--dry_run` stops here.
4. Otherwise requires `CLOUDFLARE_API_TOKEN`, runs `terraform init` + `terraform apply -var-file=…` (with `-target`s for `pages` or `worker`), then — for `pages`/`all` — `wrangler pages deploy <pages_dir> --project-name <pages_project> --branch master` (the only remaining wrangler call; Terraform cannot do Pages direct uploads).

Terraform targets: `pages` → `cloudflare_pages_project.site`, `aws_s3_object.large_assets`; `worker` → `cloudflare_workers_script.router`, `…_subdomain.router`, `…_route.router`, `terraform_data.d1_migrations`.

## D1 migrations (`d1_migrate.ts`)

Runs as a script (`node src/node/d1_migrate.ts`, invoked by Terraform's `local-exec`). Creates the `d1_migrations` table in wrangler's layout, applies unseen `migrations/*.sql` in name order, records them. Needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`. Add migrations as new numbered files; never edit an applied one.
