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

Verification uses real Node child processes, real SQLite, the actual HTTP listener, a bundled workerd Worker and synthetic secrets. It covers version isolation, shared durable state, crash restart, failed replacement, rollback, HMAC replay rejection, gateway cookie/header isolation, operator CLI status, live token revocation, scopes, route ordering, schemas and timeouts. The running production service and cloud state were not changed. See [APISERVER.md](../../APISERVER.md) for policy and remaining phases.
