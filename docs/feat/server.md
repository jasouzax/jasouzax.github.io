# Server desk (`/server`) and the Pi agent (`server/`)

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `server/` (Electron agent, own `package.json`), `shared/protocol/wire.ts` (the wire contract), `cloud/hub/hub.ts` (Durable Object + routes), `src/web/client/server_*.ts` (desk integration), `content/server.xml`
- **Replaces:** the standalone *Browsite* prototype. Everything it did (scripts, windows, live feed, APIs) lives here; nothing of Browsite remains to deploy.
- **Related guides:** [desk.md](desk.md), [filesystem.md](filesystem.md), [personal_server.md](personal_server.md), [desk_env.md](desk_env.md)

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Wire protocol shared by agent, Durable Object and page (`shared/protocol/wire.ts`)
- [x] Pi agent: Electron app that dials out to the Worker, reconnects with backoff, serves fs, pty, scripts, windows, APIs and fastfetch (logic tested without Electron)
- [x] Worker: `Server_Hub` Durable Object (hibernating sockets, endpoint map, one-minute public snapshot) and `/api/_/server/*`
- [x] Worker: `jasouza.com/api/{endpoint}` gateway to scripts that publish APIs
- [x] MIME types `application/auto-javascript` (`*.auto.js`) and `application/auto-site` (`*.auto.site`) with plugin cases
- [x] `/server` page: shared virtual desk with one fastfetch window; offline state
- [x] Page link: owner socket, heartbeat, reconnect, request/answer (`server_link.ts`)
- [x] Owner mode logic: Pi filesystem handles, pty session, window store, site keys, input mapping, log store (unit tests, the real agent channel on a temp directory)
- [ ] Owner mode in a browser: Pi filesystem as the desk root, Pi terminal, script view (logs, start/stop), site feed view (touch, zoom, sound, fit, DevTools). Browser coverage now exercises Sessions, script/site opening, shared navigation/history, View/Edit feed switching, fullscreen and audio controls using a mocked owner channel; real signed-in Pi/phone integration remains to verify
- [ ] Verify on the real Pi, Worker and a phone (not possible in the development sandbox: no Electron, no Cloudflare)

## Page side (`src/web/client`)

| File | Job |
|---|---|
| `desk_server.ts` | `server:fastfetch` source, one-minute refresh, mode from `GET /api/_/server` (`unknown`/`offline`/`public`/`owner`); `server_text.ts` holds the pure rules |
| `desk_server_owner.ts` | Owner mode on `/server` only: opens `Server_Link`, swaps the desk root (`swap_root` in `desk_fs.ts`) for the Pi and puts the virtual one back when leaving; `owner_link()`, `owner_windows` |
| `server_link.ts` | The socket: heartbeat `ping`, backoff 1-30 s, numbered `fs` requests with a 30 s timeout, subscriptions by message type |
| `server_fs.ts` | The Pi's files as `dir_handle`/`file_handle`; a file opens whole up to 32 MiB; devices and sockets are not listed |
| `server_terminal.ts`, `server_pty.ts` | `server_sh` kernel program relaying a pty (the terminal hook becomes `server:sh` while the link is up) |
| `server_script.ts`, `server_script_model.ts` | `auto_script` host: log, errors-only, clear, Start/Stop, windows of the script |
| `server_site.ts`, `server_windows.ts`, `server_input.ts`, `server_touch.ts`, `server_audio.ts` | `auto_site` host: live JPEG feed, address bar, fit, DevTools, sound, mouse/keyboard/clipboard, virtual touch mouse and zoom |

Sources that open the feed (owner link only): an `http(s)://` address typed into a window, a `*.auto.site` file whose first non-comment line is an http(s) URL (view = live page, edit = its DevTools feed), and `server:window:<id>` (a window a script opened, or its DevTools). A site's agent key is a hash of its URL, so two desk windows of one URL share one Chromium window; closing a desk pane keeps its session available in Sessions. One feed streams per tab: the window touched last (the agent keeps the newest `feed_watch`).

Without the owner link an `*.auto.js` view is the plain code, a `*.auto.site` view is its text, and an `http(s)://` source loads as before.

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

### Who sees what

| Visitor | `/server` shows | Backed by |
|---|---|---|
| Anyone, agent offline | One window: "server offline" and the last snapshot, dimmed | Durable Object storage |
| Anyone, agent online | One window with the `fastfetch` text, a shared virtual file system exactly like `/desk` (edits stay in the browser) | Snapshot cache, refreshed at most once a minute |
| Signed in as an allowed owner (`SERVER_OWNER_EMAILS`, default the Google admin e-mail), agent online | The same desk, but `/` is the agent's file system, terminals are agent shells, `application/auto-javascript` and `application/auto-site` windows are live | WebSocket through the Durable Object |

Authentication is Jazu's existing session (`__Host-jazu_session`, `read_session`). The check is server-side in the Worker; the Durable Object trusts only requests the Worker marks as owner. Other accounts get the public view (per-account containers are planned, not built).

### Topology

```
browser ──wss /api/_/server/ws (cookie, same origin)──▶ Worker ──▶ Server_Hub (Durable Object "main") ◀── wss /api/_/server/agent (HMAC signed) ── Pi agent (Electron)
public GET /api/_/server ───────────────────────────────▶ Worker (edge cache 60 s) ──▶ Server_Hub (snapshot)
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
| Worker requests, 100 000/day | Public `/api/_/server` is cached at the edge for 60 s; one snapshot refresh per minute at most, shared by every visitor |
| WebSocket message size, 1 MiB | File transfers are chunked at 384 KiB raw; API request and answer bodies are capped at 600 KiB (base64 inside one JSON frame stays under the 900 KiB frame limit) |
| Feed frames | Agent → object frames are the only costly traffic: capped at 6 fps, JPEG, dropped when the page's socket is backed up, and sent only while someone watches |

Only SQLite-backed Durable Objects exist on the free plan, so the class is declared with `new_sqlite_classes`.

### Agent (`server/`)

An Electron app started by hand on the Pi (`cd server && npm start`, or `npm run start:headless` under `xvfb`). Configuration is `server/.env`: `JAZU_ORIGIN` (default `https://jasouza.com`), `SERVER_AGENT_SECRET` (same value as the Worker secret), `SERVER_ROOT` (default `/`), optional `FASTFETCH_STRUCTURE`. Not started means "offline"; nothing else in Jazu depends on it.

- **Filesystem channel:** stat, list, chunked read/write, mkdir, remove, rename, copy. Runs as the agent's Unix user, so the operating system's permissions are the access control. Paths must be absolute and are normalised; `SERVER_ROOT` confines everything below it.
- **Terminal channel:** `/server` always selects the native PTY and never loads the browser WASM registry or commands; an unavailable agent reports offline. The prompt uses the real account, hostname and full working directory. Real shells on a pty (the `extension/host` python shim, `script` fallback), up to 8 at once, closed as soon as the page that opened them disconnects.
- **Script channel:** `*.auto.js` files run as in Browsite: the body of an `async` function with `Web`, `API`, `require`, `console`, `sleep`, scoped timers. A script is *running* until its code and timers finish; an API or a timer makes it a service. Logs (1000 per script) are kept by the agent. Stopping closes its windows and APIs. Starting persists desired-running state in `user_data/autostart.json`: boot restores it, failures retry with bounded backoff, and successful completion or manual Stop/Delete removes it. Scripts are not sandboxed: they are the owner's code on the owner's machine.
- **Window channel:** Browsite's `Web` windows streamed as a DevTools screencast, with input, navigation, DevTools, clipboard, sound and selector hints.
- **Fastfetch:** `fastfetch --pipe` with a public structure that leaves out user name, host name, local IP and locale; falls back to Node's `os` module if the binary is missing.

### Page

`desk_server.ts` reads `/api/_/server`. Public mode shows the snapshot. Owner mode opens the WebSocket, replaces the root node's handle with a remote directory handle (File System Access shaped, so the file manager, folder windows and editors need no changes), and points `terminal_hooks.uri` at `server:`. `application/auto-javascript` in *view* mode is the log view with Start/Stop; in *edit* mode it is the text editor. `application/auto-site` (or an `http(s)://` source in owner mode) is the live site feed with the virtual touch mouse, zoom, selector hints and sound. The existing window head owns back/refresh/forward and the live URL, following Chromium history for link clicks and typed addresses. Every window groups Volume and Save in a rounded control, with Fullscreen between Split and Move, in every mode; the audio preference stays with the window across mode/type changes. For `application/auto-site`, View shows the page and Edit shows that page's DevTools feed in the same pane. This built-in live host also serves file-less split mirrors before plugin lookup, so a stale plugin catalog cannot substitute a file editor. The Sessions side uses the standard `.desk_side_item` icon, name, details and toolbar layout for scripts and their windows, standalone sites, and parentless popups. Clicking an entry opens it in View. Script actions are Start/Stop, New Window, Clear Logs and Delete; stopped scripts remain available to restart. Delete removes the runtime session, its windows and logs, while its source file stays in Files. Site entries provide Delete to close the native window. A site split inherits the same native session: selecting Edit in the child streams its DevTools beside the parent page. Closing a desk pane leaves its server session running.

### Wire protocol (summary)

Every text frame is JSON with a `t` field. Owners and the agent never talk directly: the Durable Object adds `peer` (the owner socket's id) to what it relays to the agent and routes `to` (a peer or `"*"`) from the agent back. Binary frames: `[kind u8][window id u32 BE][payload]` (1 = JPEG, 2 = Opus with a float64 timestamp). Full types: `shared/protocol/wire.ts`.

| Family | Owner → agent | Agent → owner |
|---|---|---|
| filesystem | `fs {id, op, path, …}` | `fs_ok {id, …}` / `fs_err {id, code, message}` |
| terminal | `pty_open`, `pty_input`, `pty_resize`, `pty_close` | `pty_out`, `pty_exit` |
| scripts | `auto_start`, `auto_stop`, `auto_delete`, `auto_state`, `auto_logs`, `auto_clear_logs` | `auto_state`, `auto_logs`, `auto_log`, `auto_status`, `auto_deleted`, `auto_logs_cleared` |
| windows | `site_open`, `site_close`, `feed_watch`, `window_*`, `clipboard_*` | `windows`, `window_added/updated/removed`, `window_hover`, `clipboard`, binary frames |
| APIs | — | `api_set` (to the object only) |
| gateway | object → agent: `api_req {id, name, …}` | `api_res {id, status, headers, body}` |
| snapshot | object → agent: `fastfetch_req {id}` | `fastfetch_res {id, text, taken_at}` |

## Limits to remember

- Not verified against real Electron/Cloudflare in the development sandbox: every layer is unit-tested with fakes; the final box above stays unticked until it is run on the Pi.
- One agent at a time (`main` object). A second agent replaces the first.
- Script APIs answer one request at a time per name only as far as the script's handler allows; each call has a 30 s timeout (`504`).
- Sound needs `AudioDecoder` in the viewing browser.

## Staging Pi deployment — 2026-11-20

The ARM64 Pi at `192.168.1.22` runs the outbound Electron agent in the
`jazu-server-staging` Docker container, managed from
`/home/jason/jazu-server-staging/app/server`. Setup and restart commands are in
[`server/README.md`](../../server/README.md#docker-headless-linux-including-arm64).
Private settings and persistent workspace/browser data live outside the checkout.
The existing Git/publishing container remains separate.

All 56 agent tests and the TypeScript build passed on the Pi. A real Electron
smoke run also verified filesystem read/write and confinement, a Python PTY shell,
script execution, an HTTP page, live JPEG screencast frames, and Opus audio capture.
The staging Worker accepted the agent's signed connection and `/api/_/server`
reported `online: true`, `stale: false` with a fresh snapshot. This does not verify
the signed-in owner's browser DOM integration or a phone; those checklist items
remain open.

Xvfb needs `JAZU_VIRTUAL_DISPLAY=1` (set by the image): parking a window outside
the virtual screen loads the page but produces no screencast frames. Docker's
file manager exposes the container's `/`, with persistent files in `/workspace`;
the host's root filesystem is not mounted. The container runs as `jason` (UID/GID
1000), with `/home/jason` backed by the deployment's persistent `home` directory.
`/home/node` points to that home for compatibility with saved script paths.

### Embedded-frame input regression

Mouse and touch-generated pointer events, text, keys, scrolling and dragging use
Chromium input dispatch, queued per target. The old Electron `sendInputEvent`
path reached top-level controls but missed out-of-process iframe controls on the
ARM64 agent. A real Electron regression (`server/test/interaction.smoke.cjs`)
checks ordinary controls on different loopback origins, including while DevTools
is open. This enables manual interaction with embedded verification controls;
it does not solve or skip a verification challenge.
