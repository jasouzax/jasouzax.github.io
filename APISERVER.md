# Custom API server

The current implementation is the Node child-process model decided in `COMPONENTS.md`. APIs live at `/api/{id}/v{version}/...`; `_` belongs to fixed system APIs. There is one child process per script/version, running as the listener's OS user with its environment and filesystem. Docker confines the service as a whole. There is no per-API container or tenant sandbox.

## Implemented core

The Node listener owns `server/api/manager.ts`. A candidate executes immutable source, validates its configuration and compiles route schemas before activation. Activation atomically persists a release record and swaps routing; failed candidates leave the old release active. Previous code can be rolled back. Versions run side by side and share `.jazu-api-{id}.sqlite` in their common script directory. Code rollback does not reverse application data changes. Back up SQLite independently.

The Worker gateway owns only manifest matching and signed routing. It caches public manifest metadata for at most 60 seconds; tokens, scopes, access, rate limits and validation always run in server code before a handler. Browser cookies never reach the script. Cookie-authenticated mutations require the existing CSRF headers; owner authority includes passkey policy. Bearer tokens cross the private signed transport and are checked against SHA-256 hashes in the script's API config. Token removal from the live config takes effect on the next request. No edge denylist is involved.

The authored file is the body of an async function with `API`, `require`, `__filename` and `__dirname`. Use exactly one `new API({ id, version, ... })`. Node APIs and installed packages remain available. Register routes during initialization. `get`, `post`, `put`, `patch`, `delete`, `query` and general `route(method, path, options, handler)` are available; HEAD falls back to GET. Static segments outrank parameters, which outrank final `*rest`. Segments decode once; separators, dot traversal and duplicate parameter names are rejected.

JSON Schema draft-07 validation uses strict Ajv, without implicit coercion or property removal. Route options may declare `body`, `query`, `params`, `response` and required token `scopes`. `response` in the API config defaults to `'log'`; `true`/`'strict'` rejects mismatches, `false` disables response checking. `api.reply(data, status, headers)` chooses a status and bounded application headers. The platform owns JSON envelopes, cookie isolation, cache policy and response sandboxing.

`api.store` offers `get`, `set`, `delete`, `keys` and synchronous `transaction`; `store.db` exposes the same SQLite connection for application SQL. Runtime requests and schema failures are audited in that database. Supervisor activation/exit/log events are recorded privately under its state directory. Platform audit records omit bearer credentials and request bodies. Scripts control their own console output. `api.secret(name)` reads only declared, nonempty environment variables; missing declared secrets reject startup.

## Configuration

`access` defaults to `owner`. `public` allows anonymous callers; `token` requires an authorized bearer or owner session. `tokens` is an array of `{ hash, scopes, unlimited? }`. Hashes are lowercase SHA-256 hex of high-entropy service tokens. There is no rate limit by default. A configured `{ requests, seconds }` limit applies per token or IP; owners and explicitly unlimited collaborator tokens bypass it. Counters are process memory and reset on restart.

`version` is an integer 1..9999. Optional `deprecated: 'YYYY-MM-DD'` adds Deprecation and Sunset headers. At most 256 routes are allowed per version. JSON bodies/results are bounded to 512 KiB, handlers to 30 seconds and pending IPC calls to 32 per process. A parent watchdog kills unresponsive child processes and retains autostart intent. Ordinary crashes retry with capped backoff. An OS-backed SQLite lock prevents competing supervisors from sharing one state directory and releases automatically when the controller dies.

Deployment and operator commands are in [the custom API guide](docs/src/custom-apis.md). The old Electron VM prototype remains an internal automation compatibility surface, but its unversioned public gateway is retired without aliases.

## Jobs and hooks

`api.job(name, handler)` returns a handle with `run(input, { key })`. Jobs start after release activation; `api.jobs.get/list/cancel` controls durable records. Cancellation signals cooperative handlers. Restarted queued/running jobs become interrupted and never execute automatically. Jobs run serially within each child. Synchronous store transactions support nested savepoints, including atomic job enqueue.

Route option `idempotent: true` requires Idempotency-Key and binds it to version, principal, route, query and canonical JSON body. Completed results replay; changed input, pending or interrupted outcomes return 409. Authentication and hook verification run before every replay. Request/job history is retained for operator-managed cleanup; application SQL must preserve platform `api_` tables.

`api.hook(path, { verify, headers, ...options }, handler)` exposes exact UTF-8 JSON as `raw_body` to verification. Only declared provider headers cross the gateway. Authorization is available to verification; normal handler context excludes authorization and cookies. `api.webhook.send` supports optional HMAC, stable delivery keys and at most three bounded attempts. Receivers must deduplicate retries to avoid duplicate side effects. Redirects are refused. Credentials and payloads are excluded from platform delivery audit records. Interrupted deliveries are never retried automatically.

`API.open(id, version, { origin, token, timeout_ms })` supplies REST/QUERY methods with bounded JSON responses, deadlines and redirect refusal. APIs run as trusted owner code with ordinary Node network/filesystem access.

## Remaining phases

Phase 2 jobs/idempotency, verified inbound/outbound hooks and `API.open` are implemented. SSE/WebSocket channels, resume and tickets are Phase 3. Pub/sub, OpenAPI/typed clients and live log streaming are Phase 4. Durable Object/MQTT live transport and per-owner origins are Phase 5. Multi-server API registration and desk Sessions controls remain integration work. Stream `emit` must remain independent of transport. Service-token enforcement stays on the server in every phase.
