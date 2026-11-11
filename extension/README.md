# JAZU device bridge (`extension/`)

Lets the desk at `http://localhost:<port>/desk` open a **real shell on this machine** (a pty running your login shell), instead of the WebAssembly BusyBox. Meant for the kiosk setup: a Debian box with only an X server, `xinit`, and Chromium showing the desk full screen.

```
/desk page (xterm.js)
   │  window.postMessage          origin-checked: same window, same origin
content.js  (runs on http://localhost/*)
   │  chrome.runtime port         only this extension can reach it
background.js  (service worker)   approves the page origin, drops unknown message types
   │  native messaging (stdio)    Chrome starts the host only for this extension's id
host/host.ts  (Node)              validates every request, owns the ptys
   │  pipes
host/pty_shim.py  →  your shell on a pseudo-terminal
```

| Path | What it is |
|---|---|
| `manifest.json` | MV3 manifest. Permission: `nativeMessaging` only. Fixed `key`, so the extension id is always `ilknanailmbdidbefkfaaappibiangdd` |
| `allowed_origins.json` | The page origins that may use the bridge. Default `["http://localhost:8080"]` |
| `content.js`, `background.js` | The relay (see above) |
| `host/host.ts` | The native messaging host: framing, sessions, flow control |
| `host/frame.ts`, `host/protocol.ts`, `host/pty.ts`, `host/pty_shim.py` | Framing, request validation, pty backends |
| `host/install.ts` | Writes the launcher and the native messaging manifests |
| `xinitrc.example` | A kiosk `~/.xinitrc` |

## Setup on the machine

Requirements: Node 22.18+ (the project already needs it), `python3` (preferred; without it the host falls back to util-linux `script`, which works but cannot resize the terminal), and **Chromium** (Debian package `chromium`) or Chrome for Testing.

> Google Chrome (branded) removed `--load-extension` in version 137 and the workaround flag in 142, so a kiosk that loads the extension from the command line needs Chromium. With branded Chrome you can still load the extension once through `chrome://extensions` → Developer mode → *Load unpacked* inside the kiosk profile; the profile remembers it.

```sh
cd /opt/jazu                       # your clone
npm ci && npm run build            # once; `npm run serve` later rebuilds only what changed
npm run extension:install -- --origin http://localhost:8080 --user-data-dir ~/.config/jazu-desk
```

`extension:install` does three things: pins a launcher (`extension/host/jazu-host`) to the Node that ran it (Chrome starts hosts with a minimal `PATH`, so `nvm` installs would otherwise not be found); writes `jazu.desk.host.json` into `<user-data-dir>/NativeMessagingHosts/` (Chromium reads that folder first, so **the `--user-data-dir` you install for must be the one you launch with**; with no `--user-data-dir` it covers `~/.config/jazu-desk`, `~/.config/chromium` and `~/.config/google-chrome`); and, with `--origin`, rewrites `allowed_origins.json`. `--system` additionally installs to `/etc/chromium/native-messaging-hosts` (needs root). Re-run it after moving the checkout or changing Node. `npm run extension:uninstall` removes everything it wrote.

Then use `xinitrc.example` as the basis for `~/.xinitrc` and start with `startx`. Inside `/desk`, **Open terminal** now starts the device shell whenever the bridge answers; typing `host:` in a window's source field forces it, `pid:` always gives the WASM shell.

If you change the server port, run the installer again with the new `--origin` (or edit `allowed_origins.json`) and reload the extension.

## Threat model

**What you are granting.** Anything that can run JavaScript in the allowed page gets an interactive shell with *your user's* permissions. The bridge deliberately has no command allow-list: a terminal that cannot run what you type is not a terminal. Protect the page instead.

| Risk | Mitigation here | What you must still do |
|---|---|---|
| A public website reaching the shell | Content script runs only on `http://localhost/*`; the service worker accepts only the exact origins in `allowed_origins.json`, taken from the browser-verified sender (never from message content), top-level frames only. No `externally_connectable`, no host permissions | Never serve this desk from a real domain with the extension installed; never add non-localhost origins |
| Another site or extension talking to the host | Chrome starts the host only for `chrome-extension://ilknanailmbdidbefkfaaappibiangdd/` (native manifest `allowed_origins`) | Do not install untrusted extensions in the kiosk profile |
| A network attacker | The host listens on no port; `npm run serve` binds `127.0.0.1` | — |
| Another local program serving a page on the allowed port | None in software | Start the server before the browser, keep the port fixed, and treat the machine as single-user. On a shared machine any local user can bind a free port ≥ 1024, so do not use this there |
| XSS in the site | The site's CSP; the desk is built from owner-authored content only | Keep it that way: do not render third-party HTML in `/desk`, and do not browse other sites in this kiosk window |
| Malformed or hostile messages | `host/protocol.ts` accepts four request types with integer-range checks; frames above 4 MiB are refused; at most 16 shells; shell chosen by the host, never by the page | — |
| Runaway output | The host pauses the shells when Chrome's pipe is full | — |

Closing or reloading the page ends its shells (the host exits when Chrome closes its pipe, hanging up every pty). There is no reattach yet.

## Protocol (page ⇄ host)

Every message is a JSON object. The page wraps it as `{ channel: "jazu-host", direction: "to_host" | "to_page", message }` on `window.postMessage`.

| From the page | Meaning |
|---|---|
| `{type:"hello"}` | Extension answers `{type:"hello", extension, timeout_ms}` at once and starts the host |
| `{type:"open", id, cols, rows}` | New shell, `id` chosen by the page (1 … 2³¹−1) |
| `{type:"input", id, data}` | Keystrokes, base64 of UTF-8 bytes (Ctrl+C is just `\x03`) |
| `{type:"resize", id, cols, rows}` | New terminal size (1 … 500) |
| `{type:"close", id}` | Hang up the shell |

| From the host | Meaning |
|---|---|
| `{type:"host_ready", version, user, hostname, home, shell, pty}` | The host started; `pty` is `python` or `script` |
| `{type:"opened", id}` · `{type:"output", id, data}` · `{type:"exit", id, code}` | Shell lifecycle; `output.data` is base64, `code` is the shell's exit status |
| `{type:"error", id?, message}` | A request was refused |
| `{type:"host_error", message}` / `{type:"host_closed"}` | The host or the origin check failed / the connection ended |

Environment variables for the host: `JAZU_HOST_SHELL` (absolute path; overrides the account's login shell), `JAZU_HOST_PTY` (`python` or `script`).

## Troubleshooting

| Symptom | Cause |
|---|---|
| The terminal prints "Device shell unavailable…" and nothing else | The extension did not answer: not loaded, or the page origin is not allowed (check `chrome://extensions`, the port in `allowed_origins.json`) |
| `Specified native messaging host not found.` | The manifest is not in the profile Chromium runs with. Re-run `extension:install` with the same `--user-data-dir` as the launch command |
| `Access to the specified native messaging host is forbidden.` | The extension id differs from `ilknanailmbdidbefkfaaappibiangdd` (the `key` in `manifest.json` was changed) |
| `Native host has exited.` | The host crashed at start. Run `extension/host/jazu-host` in a terminal: it prints a framed `host_error` (binary-ish) and its reason on stderr; usually no `python3`/`script`, or Node older than 22.18 |
| Garbled full-screen programs after resizing | You are on the `script` fallback; install `python3` |

Verification status is tracked in [docs/feat/desk_env.md](../docs/feat/desk_env.md).
