# Nodes (`src/node`)

Code that runs on a *node* of the system: your machine's local server, the Cloudflare Worker, the personal server, and the deploy tooling. Back to [site developer guide](README.md). Status: [cloud](../feat/cloud.md), [personal server](../feat/personal_server.md), [work](../feat/work.md). Infrastructure: [../infra.md](../infra.md).

| File | Runs on | Responsibility |
|---|---|---|
| `serve.ts` | Your machine | Static server for `dist/` on `127.0.0.1`: path safety, `_headers` application, 404 page, `/work` headers |
| `worker.ts` | Cloudflare Worker (`{domain}/*`, `*.{domain}/*`) | Central router |
| `security.ts` | Worker + personal node | Security headers, API error shape, HMAC sign/verify |
| `personal.ts` | Personal server | HTTP listener: signed read-only Git adapter, health, CI run list, and the smart-HTTP route family |
| `server_config.ts` | Personal server | `server.json`: paths, collaborators, token hashing; only `site.project` is active, all others archived |
| `git_http.ts` | Personal server | `git http-backend` CGI bridge for push (and private clone): Basic-token auth, throttle, role/archive checks |
| `git_hooks.ts`, `hook_main.ts` | Personal server (inside each bare repo) | pre-receive policy + post-receive job queueing; hooks are generated and rewritten at node start |
| `git_mirror.ts` | Personal server | Builds the static dumb-HTTP mirror (`projects/{id}.git/`) that Pages serves for `git clone` |
| `queue.ts`, `runner.ts` | Personal server | Durable job queue, sequential runner, run records, working-copy watcher |
| `ci_jazu.ts` | Personal server | The one CI/CD pipeline (project `jazu`): tests gate a build + conditional `wrangler pages deploy` |
| `publish.ts` | Deploy machine / personal server | Pages staging with overlay, content fingerprint, wrangler call; shared by `deploy` and `publish` |
| `server_cli.ts` | Operator | `node src/main.ts server …`: init, repo init, user add/remove, run, status, sync |
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

## <a id="git-hub"></a>Git hub, CI/CD and the static mirror

```
git clone https://{domain}/projects/jazu   ->  Worker -> Pages (static files from git_mirror.ts; the node is never contacted)
git push  https://{user}:{token}@{domain}/projects/jazu.git
          ->  Worker (route /projects/{id}[.git]/...: info/refs?service=git-receive-pack, POST git-receive-pack)
          ->  Tunnel + Access service token, HMAC "stream" signature
          ->  node: token auth (git_http.ts) -> `git http-backend` -> pre-receive policy -> post-receive -> queue job
          ->  runner: CI (clean checkout of the pushed commit) -> CD (mirror, fast-forward working copy, publish)
```

**Projects.** Only `site.project` (`jazu`) is active. Every other project is archived by construction: pushes are refused by the node and by a generated pre-receive hook; there is no CI/CD for it. Archived public repositories are still mirrored for `git clone`. A project with `"visibility": "private"` is never mirrored; the Worker sends *all* its git traffic (clone included) to the node and it needs a token.

**Roles** (tokens created with `server user add`; only scrypt hashes are stored in `server.json`): `owner` pushes anything; `write` pushes branches but not the deploy branch or tags (owners merge, because CI executes pushed code on this machine); `read` can clone private projects. Non-fast-forward and deletion are blocked by repository config. Failed logins are throttled (8/min per user).

**CI** (`ci_jazu.ts`, push to the deploy branch only): clean checkout of that exact commit in `<state>/ci/jazu`, `npm ci` only when `package-lock.json` changed, then `npm run types`, `npm test`, `npm run check`. Any failure marks the run `failed`, deploys nothing, and leaves the working copy where it was. **CD**: refresh the mirror (pinned to the vetted commit), `git merge --ff-only` the working copy (`site.dir`; refuses if it has uncommitted tracked changes, never resets), then `node src/main.ts publish`: build, stage `dist` + mirror, compare a content fingerprint with `<state>/published.json`, run `wrangler pages deploy` only if it differs, and write the fingerprint only after wrangler succeeded.

**File changes.** A watcher on `<site.dir>/content`, `src` and `config.json` queues a CD-only job after 5 s of quiet (no tests: there is no commit to vet). Large (> 25 MiB) assets are not uploaded by `publish`; they live in R2 from `npm run deploy`.

**Environment of commands.** CI and git run with `PATH`, `HOME=<state>/home`, `CI=true` only. The publish step additionally gets `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`. Logs: `<state>/runs/<id>.log` (2 MiB cap); `GET /api/v1/ci/jazu/runs` shows a public summary (no pusher, message or paths).

**Wire details.** The Worker signs git requests with `x-jazu-body: stream`, which leaves the (huge, binary) body out of the HMAC; the node accepts that mode only on `/git-http/*`. Request bodies are capped at 512 MiB by the node, and Cloudflare's own request-size limit for your plan applies first.

Operate: `node src/main.ts server init`, `server repo init jazu`, `server user add <you> --role owner`, start with `npm run node`; `server status` / `server run` afterwards.

## <a id="deploy"></a>Deploy (`deploy.ts`)

`deploy(root, out, result, target, dry_run)`:

1. `load_env()` loads `.env` (shell variables win) and maps `ORIGIN_HMAC_SECRET`/`ACCESS_CLIENT_ID`/`ACCESS_CLIENT_SECRET` to `TF_VAR_*`.
2. `prepare_deploy()` creates `.cache/deploy/<stamp>/`: copies every file listed in `dist/.jazu_output.json` into `pages/`, **except files > 25 MiB**, which must live under `assets/media/` or `assets/wasm/` and are queued for R2; bundles `worker.ts` with esbuild (single ES module); writes `deploy.auto.tfvars.json` (worker name, pages project, domain, public project ids, personal origin, bundle path, large assets) and `uploads.json`; refreshes `.cache/deploy/latest.json`.
3. `--dry_run` stops here.
4. Otherwise requires `CLOUDFLARE_API_TOKEN`, runs `terraform init` + `terraform apply -var-file=…` (with `-target`s for `pages` or `worker`), then — for `pages`/`all` — `wrangler pages deploy <pages_dir> --project-name <pages_project> --branch master` (the only remaining wrangler call; Terraform cannot do Pages direct uploads).

Terraform targets: `pages` → `cloudflare_pages_project.site`, `aws_s3_object.large_assets`; `worker` → `cloudflare_workers_script.router`, `…_subdomain.router`, `…_route.router`, `terraform_data.d1_migrations`.

## D1 migrations (`d1_migrate.ts`)

Runs as a script (`node src/node/d1_migrate.ts`, invoked by Terraform's `local-exec`). Creates the `d1_migrations` table in wrangler's layout, applies unseen `migrations/*.sql` in name order, records them. Needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`. Add migrations as new numbered files; never edit an applied one.

### Personal-server deployment

`/projects/jazu` and `/projects/jazu.git` are equivalent Git remotes. Git metadata and pack reads are rewritten to the `.git` mirror on Pages; mutable refs use `no-cache`, immutable packs use a year-long cache. The HTML project page remains at `/projects/jazu`. `/api` returns JSON discovery links; `/api/v1/health` works while the Pi is offline.

Set `site.branch` to `master` for the hub's public deploy branch. Set optional `site.checkout_branch` to `feature/personal-server` to keep the server checkout on the development branch while fast-forwarding commits accepted on the hub's master. It defaults to `site.branch`. CI restores the ignored `build/` artifacts and `content/media/` from the deployment checkout after cleaning its isolated checkout. Mirror failures block publication.


Oversized Git packs (a historical blob cannot be split across packs) are staged for R2 under `projects/{id}.git/objects/pack/`. The Worker resolves these static pack reads against R2 before Pages, including Range and conditional requests. No pack read contacts the personal node. Publication uploads oversized assets with Wrangler before uploading Pages, and records SHA-256 hashes to avoid uploading unchanged large files again. A failed R2 upload blocks Pages publication. Set `JAZU_ASSETS_BUCKET` on the server if using a bucket other than `jazu-assets`.
