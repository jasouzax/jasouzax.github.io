# Nodes (`src/node`)

Code that runs on a *node* of the system: your machine's local server, the Cloudflare Worker, the personal server, and the deploy tooling. Back to [site developer guide](README.md). Status: [cloud](../feat/cloud.md), [personal server](../feat/personal_server.md), [work](../feat/work.md). Infrastructure: [../infra.md](../infra.md).

| File | Runs on | Responsibility |
|---|---|---|
| `serve.ts` | Your machine | Static server for `dist/` on `127.0.0.1`: path safety, `_headers` application, 404 page, `/work` headers |
| `worker.ts` | Cloudflare Worker (`{domain}/*`, `*.{domain}/*`) | Central router |
| `security.ts` | Worker + personal node | Security headers, API error shape, HMAC sign/verify |
| `personal.ts` | Personal server | HTTP listener: signed read-only Git adapter, health, CI run list, and the smart-HTTP route family |
| `server_config.ts` | Personal server | Private paths/collaborators, project views and XML catalog loading |
| `git_http.ts` | Personal server | `git http-backend` CGI bridge for push (and private clone): Basic-token auth, throttle, role/archive checks |
| `git_hooks.ts`, `hook_main.ts` | Personal server (inside each bare repo) | pre-receive policy + post-receive job queueing; hooks are generated and rewritten at node start |
| `git_mirror.ts` | Personal server | Builds the static dumb-HTTP mirror (`projects/{id}.git/`) that Pages serves for `git clone` |
| `queue.ts`, `runner.ts` | Personal server | Durable job queue, sequential runner, run records, working-copy watcher |
| `pipeline.ts`, `project_catalog.ts` | Personal server | Generic XML ci/build/deploy execution, per-project checkouts and catalog reload; `ci_jazu.ts` is an import compatibility shim |
| `listener_main.ts`, `job_process.ts`, `job_main.ts`, `pipeline_process.ts` | Personal server | Minimal service entry, exact-commit engine staging, fresh catalog/pipeline workers, subprocess/environment primitives |
| `repo_sync.ts` | Personal server | Provider-independent external/local commit imports and CI-gated upstream export |
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

**Projects.** A `<project repo="…">` or `<project><pipeline>…</pipeline></project>` declaration activates a managed repository. Every project has its own branch and policy, private working-directory override, isolated CI checkout and sync/publication state. Undeclared legacy entries remain archived. Private projects never enter the public mirror or catalog. Archived managed repositories retain approved refs; their review branches stay private.

**Roles** (tokens created with `server user add`; only scrypt hashes are stored in `server.json`): `owner` pushes anything; `write` pushes branches but not the deploy branch or tags (owners merge, because CI executes pushed code on this machine); `read` can clone private projects. Non-fast-forward and deletion are blocked by repository config. Failed logins are throttled (8/min per user).

**CI** (`pipeline.ts`, each project's deploy branch): clean exact-commit checkout, then the project's XML `ci` steps. Any failure marks the run `failed`, deploys nothing and leaves the working copy unchanged. **CD**: create or fast-forward the matching working checkout, export the tested SHA upstream, refresh that project's approved mirror, execute `build`, then `deploy` steps. Engine publication collects the shared approved mirror overlay. Jazu's concrete npm/types/tests/check/build/Pages commands live in its XML declaration; install frequency and command selection are author-defined rather than hardcoded. Its `publish --skip_build` step compares fingerprints and uploads Pages/R2 only when the prepared output differs.


**File changes.** A watcher on `<site.dir>/content`, `src` and `config.json` queues a CD-only job after 5 s of quiet (no tests: there is no commit to vet). Large (> 25 MiB) website assets and Git packs are uploaded to R2 before Pages; unchanged large objects are skipped using recorded content hashes.

**Environment of commands.** Pipeline steps run with a scrubbed `PATH`, `HOME=<project-state>/home` and `CI=true` environment. Each deploy step receives its explicitly requested credential names. Network Git/SSH separately uses the service user’s credential setup. Logs: `<state>/runs/<id>.log` (2 MiB cap); `GET /api/v1/ci/jazu/runs` shows a public summary (no pusher, message or paths).

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


## Per-project repositories and XML pipelines

### Multiple branch pipelines

`Project_Declaration.pipelines` and `Server_Config.pipelines` index definitions by branch; `pipeline` retains the first/primary entry for compatibility. `project_branches()` enumerates deployment refs, and `project_view(config, id, branch)` selects commands, upstream branch and private state while preserving the same working directory. The first pipeline remains primary and controls public clone refs. Pipeline branch names must be unique, including the implicit `master` default.

Hooks queue every declared pipeline ref and protect all of them from write-role tokens. The runner polls each project/branch independently; queue coalescing keys include the ref, and upstream deduplication includes both ref and commit. One SHA on two branches represents two jobs. Secondary branches use separate upstream tracking refs and state at `<project-state>/branches/<URL-encoded-branch>/`; the primary keeps its existing paths. An upstream branch that has never existed remains idle until created, while disappearance of a previously observed branch remains an error.

`pipeline.ts` reuses a single exact-commit CI workspace per project. After tests pass, a multi-pipeline project switches its one deployment checkout with `git switch`, then fast-forwards that target branch. Existing target branches cannot be reset or overwritten; dirty worktrees and unmanaged active branches block promotion. The checkout stays on the last successful job's branch. Failed CI does not switch it. There are no per-branch deployment worktrees or clones. Branch state and publication fingerprints are separate even though the working directory and ignored build inputs are shared.

Only primary jobs refresh the public Git mirror or request primary engine mirror publication. A CD-only request for an inactive branch is marked superseded/deferred instead of publishing the wrong checkout or switching branches without a branch update. Pending mirror changes are published when the primary engine next updates, or an operator explicitly runs that branch. File-change jobs carry the current declared branch. Run summaries retain `ref`; HTTP summaries accept `?branch=...`, and `server run/status` accept `--branch`.

For multi-branch jobs, the short-lived worker must advertise `branch_pipelines` through its `capabilities` mode before it can run. Old engine revisions fail this check without promoting the checkout; merge the feature into staging before deploying experiments. `build --base_url <origin>` overrides canonical URLs in memory without editing `config.json`; `publish --pages_project <name> --branch <branch> --assets_bucket <bucket>` selects the deployment targets. Jazu's XML supplies these flags; the listener has no hardcoded Jazu/staging target logic. See [post-merge setup](../infra-staging.md) for the example's separate Pages project, Worker and R2 bucket.

The authoring contract is [project.md](../content/project.md#pipeline--repository-synchronization-and-cicd). `pipeline_types.ts` shares repository normalization and pipeline validation between the schema and server. `project_catalog.ts` reads project roots from the engine checkout's content XML without rendering them; conflicting translated declarations fail closed. `server_config.ts` merges portable behavior with private path/visibility/archive overrides. `project_view()` selects an individual project without changing the common queue or engine identity.

The idle sequential runner reloads catalog changes, initializes bare repositories/hooks, and polls each project's configured branch. `repo_sync.ts` detects committed clean local checkout changes and external upstream advances. A private tracking ref and compare-and-swap update prevent overwriting a concurrent hub push; a durable import intent recovers interrupted queueing. Incoming external jobs have `kind: "upstream"`; committed checkout changes use `kind: "push"`. Identical tips produce no job. Network commands are asynchronous, time-limited and use the service account's SSH/credential setup separately from CI HOME.

**Runtime isolation.** `src/main.ts node` enters `listener_main.ts` without importing the build/render command tree. The persistent process handles transport, polling and the durable queue. Catalog validation runs in a short-lived `job_main.ts catalog` process from the current engine checkout. A failed catalog reload retains the last valid in-memory catalog and still polls repositories and drains jobs; identical errors are reported once until the error changes or validation succeeds.

For an engine commit, `job_process.ts` first stages the exact SHA in `<state>/runtime`, a private reusable Git clone. It installs that commit's locked dependencies with a scrubbed environment when its lock hash changes, then starts that checkout's `job_main.ts run`. The incoming engine therefore parses its own project declarations and runs its own `pipeline.ts`; a schema added alongside content is never checked using a previous process's schema cache. Other projects run fresh workers from the current engine checkout. CI still tests an isolated exact-commit clone before promoting the working checkout or exporting upstream. Failed workers are recorded as failed jobs and do not terminate the listener; a later corrective commit can run normally. Runtime dependencies are a bootstrap step in the job log, separate from the author-defined pipeline steps.

The listener fingerprints `src/`, `package.json`, `package-lock.json` and `tsconfig.json`. After a job finishes and its durable queue entry is completed, changed runtime files in a clean working copy stop further queue draining and request a listener restart. Uncommitted tracked edits defer restart. Pending jobs remain queued. The listener closes its HTTP server (up to ten minutes for in-flight Git requests), exits **75**, and the supervisor starts it from the updated checkout. Keep systemd `Restart=on-failure` (or `always`) enabled; a bare terminal invocation exits and must be started again. Content-only edits do not request a runtime restart. The initial installation of this isolation mechanism requires one service restart; an already-running older listener cannot acquire it from memory.

The worker stdin protocol (`catalog`/`run`), durable queue/run formats and `src/node/job_main.ts` entry are the compatibility boundary. Removing these, requiring a newer Node runtime or changing the service entry still requires an operator migration. Catalog workers have a 30-second bound; pipeline workers have a six-hour outer bound in addition to individual step timeouts. On Unix, each worker owns a process group so timed-out/crashed worker descendants are terminated before the next job. This is process isolation, not a sandbox: engine commits and owner-approved pipeline commands remain trusted code.

`pipeline.ts` executes the XML steps. `ci` uses a clean exact-commit clone; failures stop before working-copy advancement, upstream export, mirror update, build or deploy. After success the working copy advances and the same tested SHA is pushed upstream with a non-force refspec. An independently advanced working copy is rejected. `build` runs without server credentials; `deploy` receives only the environment names explicitly requested by each step. Commands and JSON argument arrays run without an implicit shell. Only trusted engine-catalog changes can change pipeline policy. The legacy `ci_jazu.ts` path re-exports the generic executor and contains no Jazu command list.

Project state is isolated under `<state>/projects/<id>/` for non-engine projects. Logs/jobs remain in the common queue/runs directories. Mirror files share `<state>/mirror/projects/<id>.git`; refresh uses each project's own branch and CI approval, including managed repos later archived or removed from XML. Successful public project workflows queue an engine CD job so its declared publication command ships the updated mirrors. Jazu's XML build runs `npm run build`; its deploy step calls `publish --skip_build` with the shared overlay and its fingerprint state, avoiding a second build.

The build emits `projects/git.json` containing only public managed ids. With `PUBLIC_PROJECTS_MANIFEST` set, the Worker discovers public ids from this static Pages file, caches it for up to 60 seconds and routes their clone reads to Pages/R2 without contacting the node. The manifest request receives no client credentials. Explicit `PUBLIC_PROJECTS` bindings remain supported. The production Wrangler config and Terraform binding enable the manifest; newly added public projects then require no per-project Worker deployment.

The top-level private `upstream` field is retained only as an engine compatibility input; `<project repo>` takes precedence. Old hardcoded Jazu pipeline defaults have been removed, so the committed XML declaration must be installed with the runtime update. The generic implementation and provider simulation are verified using temporary real Git repositories. Production activation on 2026-11-12 passed all 157 tests and published Pages/R2 at `8d39520`; the Pi checkout, personal hub, and GitHub `master` agree. Job `1794453724599_16490bb4` records the successful pipeline under `/home/jason/.local/state/jazu/runs/`. The Pi uses its existing SSH key for GitHub synchronization via a Git HTTPS-to-SSH URL rewrite.
