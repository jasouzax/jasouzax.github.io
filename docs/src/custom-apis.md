# Versioned custom APIs

Requires Node 22.18+ and the repository dependencies. Start the normal Node listener with `ORIGIN_HMAC_SECRET` configured (`npm run node` loads the root `.env`). APIs do not require Electron. `server.json` is optional for API-only use; it enables the existing repository/pipeline components. API state lives under `<state_dir>/apis`, default `.server/apis`.

Write `counter.auto.js` in a persistent directory owned by the listener's user:

```js
const api = new API({ id: 'counter', version: 1 });
api.get('/', () => ({ count: api.store.get('count') || 0 }));
api.post('/', {
    body: { type: 'object', properties: { increment: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['increment'], additionalProperties: false }
}, ({ body }) => api.store.transaction(() => {
    const count = (api.store.get('count') || 0) + body.increment;
    api.store.set('count', count);
    return api.reply({ count }, 201);
}));
```

```sh
node src/main.ts server api deploy /absolute/path/counter.auto.js
node src/main.ts server api status
node src/main.ts server api rollback counter 1
node src/main.ts server api stop counter 1
```

These commands contact the existing loopback listener on port 8788; `--port` selects another port. They load root `.env` without changing it and HMAC-sign management requests. Deploy runs trusted source with the listener's user/environment. The sample defaults to owner-only access, so anonymous requests receive 404. After deploying the matching Worker, a signed-in owner can call `/api/counter/v1/`; POST also needs `origin`, `x-jazu-work: 1` and `x-jazu-csrf` from `/api/_/session`. Successful JSON has `{ data, meta: { request_id } }`; failures have `{ error: { code, message }, meta }`.

For service access, `node src/main.ts server api token` prints a new token and its hash once. Store the plaintext in the calling service and put only the hash plus allowed scopes in the API config. Choose `access: 'token'`, or use tokens to grant scoped operations on a public API. Route `scopes: ['counter:write']` requires those exact token scopes; owners bypass scopes. Tokens do not grant access to an owner-only API. Updating the source and redeploying replaces the active policy; scripts may also remove live `api.config.tokens` entries immediately.

Changing `version` to 2 and deploying keeps v1 available. Versions of an id must be authored in the same directory so they share one store. Starting the listener restores the exact saved source releases, even if authored files changed afterwards. Stopping removes restart intent. Candidate evaluation can perform application side effects, so use deliberate, reversible application migrations; rollback restores code, not database history.

The gateway uses existing `PERSONAL_ORIGIN`, `ORIGIN_HMAC_SECRET` and optional Cloudflare Access credentials. It fetches a safe manifest over signed transport, then sends a signed JSON call with verified owner/subject metadata. Access/token values never enter manifests or public status. The Node server accepts deployment/rollback/stop only from the separate `api-admin` signing context. Deploy the Worker and listener together to enable versioned routes; existing public unversioned API routes have no compatibility alias.

Source map: `shared/api/{types,routes}.ts` defines transport/matching; `server/api/{runtime,store,output}.ts` owns policy/handlers/SQLite; `{child,process,manager}.ts` owns script execution and deployment; `server/api/http.ts` owns signed origin ingress; `cloud/gateway.ts` owns edge routing; `src/tools/api.ts` owns local commands. Git and Docker ignore `.jazu-api-*.sqlite*` so store/sidecars are not shipped as authored source.

## Live updates and devices

```js
const api = new API({ id: 'sensors', version: 1, access: 'token',
    tokens: [{ hash: 'REPLACE_WITH_YOUR_TOKEN_SHA256', scopes: ['read', 'write', 'logs'] }]
});
api.stream('/events', { scopes: ['read'] }, () => api.pubsub.channel('temperature'));
api.post('/temperature', { scopes: ['write'], body: {
    type: 'object', properties: { c: { type: 'number' } }, required: ['c'], additionalProperties: false
} }, ({ body }) => ({ event_id: api.pubsub.publish('temperature', body) }));
api.socket('/echo', { scopes: ['write'] }, (_, socket) => {
    socket.send({ ready: true });
    socket.onmessage = value => socket.send({ echo: value });
});
api.stream('/logs', { scopes: ['logs'] }, () => api.logs);
api.get('/openapi.json', { scopes: ['read'] }, () => api.openapi());
api.get('/client', { scopes: ['read'] }, () => api.client()); // JSON envelope containing TypeScript text
```

Replace the token hash with an actual generated hash before deployment. `curl -N -H 'Authorization: Bearer YOUR_TOKEN' https://DOMAIN/api/sensors/v1/events` receives SSE. Publish JSON to `/temperature` using the write-scoped bearer; the next event contains that value. Reconnect with `Last-Event-ID` to replay retained events. Missing history or a restarted release returns 409; reconnect without the old cursor to begin a new stream.

For browser clients, POST `{}` as JSON to the stream/socket path with the bearer or owner CSRF headers. The result contains `data.ticket`. Open `new EventSource('/api/sensors/v1/events?ticket=' + encodeURIComponent(ticket))` or a same-origin WebSocket at `/api/sensors/v1/echo?ticket=...` (use `wss:` on HTTPS). Each ticket can be used once and expires after 30 seconds. Owner tickets also require the same current owner cookie. Tickets are credentials: do not put their URLs in analytics or shared logs. WebSocket messages are JSON; replies are `{id,event,data}`. SSE `jazu-error` or WebSocket closure means reconnect after resolving authorization/history/origin availability. Streams expire after 15 minutes, so reconnecting is part of a client implementation.

Channels retain up to 256 events/256 KiB, frames are at most 16 KiB, and edge reads normally poll the origin once a second. Custom WebSocket connections and polling count against the Cloudflare plan. This is a direct transport adapter, not Durable Object fanout. Browser WebSockets without tickets, cross-origin upgrades and REST endpoints requested as WebSockets are rejected. Explicit `api.log('info', 'message')` writes to `api.logs`; console output and environment variables are never automatically exposed.

For MQTT devices, add declared secrets to `new API({ ..., secrets: ['MQTT_USER', 'MQTT_PASSWORD'] })` and register this during initialization:

```js
const bridge = api.pubsub.mqtt({
    url: 'mqtts://YOUR_BROKER:8883', prefix: 'owner/sensors/',
    topics: ['temperature'], publish: ['commands'],
    username_secret: 'MQTT_USER', password_secret: 'MQTT_PASSWORD'
});
api.post('/commands', { scopes: ['write'] }, async ({ body }) => {
    await bridge.ready;
    await bridge.publish('commands', body);
    return { sent: true };
});
```

The bridge connects only after the release activates. Do not await readiness at script top level: a candidate must finish initialization before it can activate. Exact broker topics under `owner/sensors/temperature` become local `temperature` events; publications go to `owner/sensors/commands`. The broker's ACLs must enforce those prefixes. The bridge uses MQTT 5, TLS except on loopback, QoS 0 and no retained publications. Offline publication fails without a queue. Device retention/recovery is an application decision, not a delivery guarantee.

## Owner Sessions

On `/server`, open Sessions and use Custom APIs. Enter an absolute `.auto.js` path that exists in the Node listener's filesystem and deploy it. Each version shows its source path and online state, plus rollback (when a previous release exists) and stop. Changes require a current owner session and CSRF. A failed candidate keeps the prior version active; the entered path and loaded list remain available for correction. Browser automation scripts/windows and Node API releases are separate sessions, even when they use similarly named source files.

The fixed BFF is GET `/api/_/apis`, POST `/api/_/apis/deploy` with `{source}`, and POST `/api/_/apis/rollback|stop` with `{id,version}`. It never sends cookies/bearers to the origin and cannot execute arbitrary supervisor commands. Multi-server selection, Durable Object transport and per-owner API origins are still pending.

Verification uses real Node child processes, real SQLite, the actual HTTP listener, a bundled workerd Worker and synthetic secrets. It covers version isolation, shared durable state, crash restart, failed replacement, rollback, HMAC replay rejection, gateway cookie/header isolation, operator CLI status, live token revocation, scopes, route ordering, schemas and timeouts. The running production service and cloud state were not changed. See [APISERVER.md](../../APISERVER.md) for policy and remaining phases.

## APIs published by automation scripts

Scripts run as `application/auto-javascript` in the personal-server browser agent use the named API interface:

```js
const api = new API('test', { public: true });
api.get('', () => ({ msg: 'Hello World' }));
await new Promise(() => {});
```

While this script is running and the agent is connected, `GET /api/test` returns `{"msg":"Hello World"}`. The root path also accepts a trailing slash. Named APIs default to private; without `public: true`, only the authenticated site owner can call them. Stopping the script removes its published routes. Unknown and inaccessible private APIs both return 404; a known API with an offline agent returns 503. The hub applies its existing public request limits and the gateway filters response headers and sandboxes HTML.

These routes use the browser agent's existing API registry and relay. `/api/{id}/v{n}` retains precedence and continues to use the separate versioned Node API platform above. Deploy the updated website Worker to activate named automation routing; pushing Git branches does not itself replace an already running Worker or server image.
