# Server desk (`/server`) and the Pi agent (`server/`)

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `server/` (Electron agent, own `package.json`), `server/src/shared/protocol.ts` (the wire contract), `src/node/server_hub.ts` (Durable Object + routes), `src/web/client/server_*.ts` (desk integration), `content/server.xml`
- **Replaces:** the standalone *Browsite* prototype. Everything it did (scripts, windows, live feed, APIs) lives here; nothing of Browsite remains to deploy.
- **Related guides:** [desk.md](desk.md), [filesystem.md](filesystem.md), [personal_server.md](personal_server.md), [desk_env.md](desk_env.md)

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [ ] Wire protocol shared by agent, Durable Object and page (`server/src/shared/protocol.ts`)
- [ ] Pi agent: Electron app that dials out to the Worker, reconnects with backoff, serves fs, pty, scripts, windows, APIs and fastfetch
- [ ] Worker: `Server_Hub` Durable Object (hibernating sockets, endpoint map, one-minute public snapshot) and `/api/server/*`
- [ ] Worker: `jasouza.com/api/{endpoint}` gateway to scripts that publish APIs
- [ ] MIME types `application/auto-javascript` (`*.auto.js`) and `application/auto-site` (`*.auto.site`) with plugin cases
- [ ] `/server` page: shared virtual desk with one fastfetch window; offline state
- [ ] Owner mode: Pi filesystem as the desk root, Pi terminal, script view (logs, start/stop), site feed view
- [ ] Verify on the real Pi, Worker and a phone (not possible in the development sandbox: no Electron, no Cloudflare)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

### Who sees what

| Visitor | `/server` shows | Backed by |
|---|---|---|
| Anyone, agent offline | One window: "server offline" and the last snapshot, dimmed | Durable Object storage |
| Anyone, agent online | One window with the `fastfetch` text, a shared virtual file system exactly like `/desk` (edits stay in the browser) | Snapshot cache, refreshed at most once a minute |
| Signed in as an allowed owner (`SERVER_OWNER_EMAILS`, default the Google admin e-mail), agent online | The same desk, but `/` is the Pi's real file system, terminals are real Pi shells, `application/auto-javascript` and `application/auto-site` windows are live | WebSocket through the Durable Object |

Authentication is Jazu's existing session (`__Host-jazu_session`, `read_session`). The check is server-side in the Worker; the Durable Object trusts only requests the Worker marks as owner. Other accounts get the public view (per-account containers are planned, not built).

### Topology

```
browser ──wss /api/server/ws (cookie, same origin)──▶ Worker ──▶ Server_Hub (Durable Object "main") ◀── wss /api/server/agent (HMAC signed) ── Pi agent (Electron)
public GET /api/server ───────────────────────────────▶ Worker (edge cache 60 s) ──▶ Server_Hub (snapshot)
GET|POST /api/{name}/… ───────────────────────────────▶ Worker ──▶ Server_Hub (endpoint map) ──▶ Pi agent ──▶ the script that published `name`
```

The Pi only makes **outbound** connections, so no tunnel or open port is needed. The old Cloudflare Tunnel/Access path for Git is untouched.

### Endpoint map (instead of redeploying the Worker)

Wrangler/Terraform cannot run inside a Worker and redeploying per endpoint would be slow and rate limited. A script's `new API("name")` makes the agent send `api_set` to the Durable Object, which stores `{name, public}` pairs. `/api/{name}/…` asks the Durable Object; an unknown name, or a private name asked by a non-owner, answers the same `404`, so visitors cannot learn which endpoints exist. `v1`, `server`, `api`, `css`, `js` and `ws` are reserved.

### Cloudflare free-tier budget

| Resource (free plan) | How this design spends it |
|---|---|
| Durable Object requests, 100 000/day; incoming WebSocket messages count 1 per 20 | Hibernation API; the agent and page heartbeats are answered by `setWebSocketAutoResponse` and never wake the object; the agent sends **nothing** while no owner is connected (logs are kept in its ring buffer and replayed) |
| Durable Object duration, 13 000 GB-s/day | A hibernated object is not billed; only active streaming (a watched site window) keeps it awake |
| Worker requests, 100 000/day | Public `/api/server` is cached at the edge for 60 s; one snapshot refresh per minute at most, shared by every visitor |
| WebSocket message size, 1 MiB | File transfers are chunked at 384 KiB raw; API bodies are capped at 768 KiB |
| Feed frames | Agent → object frames are the only costly traffic: capped at 6 fps, JPEG, dropped when the page's socket is backed up, and sent only while someone watches |

Only SQLite-backed Durable Objects exist on the free plan, so the class is declared with `new_sqlite_classes`.

### Agent (`server/`)

An Electron app started by hand on the Pi (`cd server && npm start`, or `npm run start:headless` under `xvfb`). Configuration is `server/.env`: `JAZU_ORIGIN` (default `https://jasouza.com`), `SERVER_AGENT_SECRET` (same value as the Worker secret), `SERVER_ROOT` (default `/`), optional `FASTFETCH_STRUCTURE`. Not started means "offline"; nothing else in Jazu depends on it.

- **Filesystem channel:** stat, list, chunked read/write, mkdir, remove, rename, copy. Runs as the agent's Unix user, so the operating system's permissions are the access control. Paths must be absolute and are normalised; `SERVER_ROOT` confines everything below it.
- **Terminal channel:** real shells on a pty (the `extension/host` python shim, `script` fallback), up to 8 at once, closed as soon as the page that opened them disconnects.
- **Script channel:** `*.auto.js` files run as in Browsite: the body of an `async` function with `Web`, `API`, `require`, `console`, `sleep`, scoped timers. A script is *running* until its code and timers finish; an API or a timer makes it a service. Logs (1000 per script) are kept by the agent. Stopping closes its windows and APIs. Scripts are not sandboxed: they are the owner's code on the owner's machine.
- **Window channel:** Browsite's `Web` windows streamed as a DevTools screencast, with input, navigation, DevTools, clipboard, sound and selector hints.
- **Fastfetch:** `fastfetch --pipe` with a public structure that leaves out user name, host name, local IP and locale; falls back to Node's `os` module if the binary is missing.

### Page

`desk_server.ts` reads `/api/server`. Public mode shows the snapshot. Owner mode opens the WebSocket, replaces the root node's handle with a remote directory handle (File System Access shaped, so the file manager, folder windows and editors need no changes), and points `terminal_hooks.uri` at `server:`. `application/auto-javascript` in *view* mode is the log view with Start/Stop; in *edit* mode it is the text editor. `application/auto-site` (or an `http(s)://` source in owner mode) is the live site feed with the virtual touch mouse, zoom, selector bar, window-size toggle, back/forward/refresh, DevTools and sound.

### Wire protocol (summary)

Every text frame is JSON with a `t` field. Owners and the agent never talk directly: the Durable Object adds `peer` (the owner socket's id) to what it relays to the agent and routes `to` (a peer or `"*"`) from the agent back. Binary frames: `[kind u8][window id u32 BE][payload]` (1 = JPEG, 2 = Opus with a float64 timestamp). Full types: `server/src/shared/protocol.ts`.

| Family | Owner → agent | Agent → owner |
|---|---|---|
| filesystem | `fs {id, op, path, …}` | `fs_ok {id, …}` / `fs_err {id, code, message}` |
| terminal | `pty_open`, `pty_input`, `pty_resize`, `pty_close` | `pty_out`, `pty_exit` |
| scripts | `auto_start`, `auto_stop`, `auto_state`, `auto_logs`, `auto_clear_logs` | `auto_state`, `auto_logs`, `auto_log`, `auto_status`, `auto_logs_cleared` |
| windows | `site_open`, `site_close`, `feed_watch`, `window_*`, `clipboard_*` | `windows`, `window_added/updated/removed`, `window_hover`, `clipboard`, binary frames |
| APIs | — | `api_set` (to the object only) |
| gateway | object → agent: `api_req {id, name, …}` | `api_res {id, status, headers, body}` |
| snapshot | object → agent: `fastfetch_req {id}` | `fastfetch_res {id, text, taken_at}` |

## Limits to remember

- Not verified against real Electron/Cloudflare in the development sandbox: every layer is unit-tested with fakes; the final box above stays unticked until it is run on the Pi.
- One agent at a time (`main` object). A second agent replaces the first.
- Script APIs answer one request at a time per name only as far as the script's handler allows; each call has a 30 s timeout (`504`).
- Sound needs `AudioDecoder` in the viewing browser.
