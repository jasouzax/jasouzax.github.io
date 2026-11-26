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

Deployment and operator commands are in [the custom API guide](docs/src/custom-apis.md). Automation scripts also expose named APIs at `/api/{name}` through the authenticated agent hub. Public access requires `{ public: true }`; private APIs are visible only to the site owner. Versioned paths `/api/{id}/v{n}` continue to use this separate Node API platform and take routing precedence.

## Jobs and hooks

`api.job(name, handler)` returns a handle with `run(input, { key })`. Jobs start after release activation; `api.jobs.get/list/cancel` controls durable records. Cancellation signals cooperative handlers. Restarted queued/running jobs become interrupted and never execute automatically. Jobs run serially within each child. Synchronous store transactions support nested savepoints, including atomic job enqueue.

Route option `idempotent: true` requires Idempotency-Key and binds it to version, principal, route, query and canonical JSON body. Completed results replay; changed input, pending or interrupted outcomes return 409. Authentication and hook verification run before every replay. Request/job history is retained for operator-managed cleanup; application SQL must preserve platform `api_` tables.

`api.hook(path, { verify, headers, ...options }, handler)` exposes exact UTF-8 JSON as `raw_body` to verification. Only declared provider headers cross the gateway. Authorization is available to verification; normal handler context excludes authorization and cookies. `api.webhook.send` supports optional HMAC, stable delivery keys and at most three bounded attempts. Receivers must deduplicate retries to avoid duplicate side effects. Redirects are refused. Credentials and payloads are excluded from platform delivery audit records. Interrupted deliveries are never retried automatically.

`API.open(id, version, { origin, token, timeout_ms })` supplies REST/QUERY methods with bounded JSON responses, deadlines and redirect refusal. APIs run as trusted owner code with ordinary Node network/filesystem access.

## Streams, pub/sub and generated clients

`api.channel(name)` returns a transport-independent JSON channel. `api.stream(path, options?, handler)` registers an SSE GET and a ticket-minting POST at the same path; its handler returns a channel. `api.socket(path, options?, (context, socket) => ...)` registers a JSON WebSocket and the corresponding ticket POST. Socket callbacks use `send`, `onmessage`, `onclose` and `close`. Browser WebSockets require a same-origin ticket; bearer clients may authenticate the upgrade directly. Cookie-authenticated ticket creation requires CSRF. Tickets expire after 30 seconds, are single-use and stay bound to the route and owner session when applicable.

GET Last-Event-ID resumes a channel's retained history. Event IDs include a release-local epoch; unavailable history, changed releases and restarts fail explicitly instead of silently omitting events. Each channel retains at most 256 events/256 KiB; each JSON event is at most 16 KiB. There are at most 128 named channels, 128 live connections and 128 pending tickets per release. Connections expire after 15 minutes or 60 seconds without an origin operation. They must reconnect. Socket messages have four pending operations per edge connection and execute in order. Slow consumers fall behind bounded history and disconnect.

The edge adapter polls signed origin IPC in batches of up to 16 events, normally once a second. Every read and send rechecks current server policy, service-token revocation and scopes; owner sessions are also checked in D1 at the edge. Configured request limits charge connection/ticket creation and socket sends, not internal read/close operations. Credentials stay in private process memory, never manifests, frames or audit detail. Streams do not bypass public/owner/token access. Custom WebSockets and polling consume Cloudflare requests/usage; the owner upgrade includes a usage header. This implementation uses a direct edge adapter; it does not claim hibernating Durable Object fanout.

`api.pubsub.publish(topic, value)`, `subscribe(topic, callback)` and `channel(topic)` share those bounded exact-topic channels. Subscribe returns an unsubscribe function. Delivery is process-local, ephemeral and best effort; application persistence belongs in `api.store`. `api.logs` is a channel of explicit `api.log(level, message)` records. Expose it only through a deliberately scoped stream. No console or secret environment is automatically published.

`api.openapi()` returns OpenAPI 3.1 with declared schemas, token scopes, stream metadata and the QUERY extension. `api.client()` returns standalone TypeScript REST client source with schema-derived inputs/results. These are explicit methods; scripts choose whether and how to publish them. Neither method includes credentials, handlers or script paths.

`api.pubsub.mqtt({url, prefix, topics, publish?, username_secret?, password_secret?})` registers an MQTT 5 bridge. It starts only after release activation and closes before replacement/shutdown. TLS is required except on loopback. Credentials must name declared secrets; URLs cannot carry them. Up to four bridges use explicit namespace prefixes and at most 64 exact inbound/outbound topics each. Await `bridge.ready` inside an active handler/job, never during script initialization. Bounded JSON input publishes to local topic channels; `bridge.publish(topic, data)` sends QoS 0, non-retained messages only to declared output topics. Offline output fails without queueing. Broker ACLs must enforce the same namespace; this client is not a broker or a tenant sandbox.

## Owner management and remaining work

The `/server` Sessions menu lists Node API versions and offers absolute server-path deployment, rollback and stop. Its owner-only BFF is `/api/_/apis`; writes require CSRF and use the separate signed `api-admin` context. A failed deployment retains the previous release and the entered path. The source path must exist in the Node listener's filesystem, including when the automation browser runs in another container. CLI management remains available.

Phases 1–4 and the MQTT bridge are implemented. Durable Object live transport, per-owner origins and multi-server API registration remain development work. The current same-origin JSON/SSE sandbox policy is not per-owner origin isolation. Service-token enforcement stays on the server in every phase.
