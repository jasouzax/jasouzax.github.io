# Desktop (`desk`): runtime and WASM toolchain

The `/desk` workspace runs real GNU/Linux programs in the browser without a VM: a browser kernel, a shared filesystem, and C programs compiled to WebAssembly. Back to [site developer guide](README.md). Authoring: [../content/desk.md](../content/desk.md). Status: [../feat/desk.md](../feat/desk.md), [../feat/plugins.md](../feat/plugins.md).

For executable examples, supported languages, image commands, SQLite and reproducible builds, see the [Desk command guide](desk-commands.md).

Detailed, authoritative notes that live next to the code (read them before changing the shell or ports):

- [`src/desk/README.md`](../../src/desk/README.md) — BusyBox ash port, runtime boundary, rebuilding, current limits, verification.
- [`src/desk/programs/README.md`](../../src/desk/programs/README.md) — fastfetch, htop, TinyCC, users/`su`, WSL rebuild.
- [`content/plugins/README.md`](../../content/plugins/README.md) — plugin cases and scripts.

## Runtime architecture (summary)

```
 window (xterm.js, desk_proc.ts)
        │ text/bytes
 kernel.ts ── process table, pids, descriptors, pipes, signals
        │ requests via SharedArrayBuffer mailbox (wasm_protocol.ts)
 wasm_host.ts ── registers executable images, verifies SHA-256, caches modules, services kernel calls
        │
 wasm_worker*.ts ── one Web Worker per process; Atomics.wait only inside Workers
        │
 BusyBox ash / fastfetch / htop / tcc  (Emscripten output in src/desk/*/artifacts)
```

- Filesystem calls from a program go to the main-thread kernel, which reads the **same tree as the file manager** (`desk_vfs.ts` over `desk_fs.ts`): `/home/user` (OPFS or connected folder), `/tmp` (memory), `/srv`, plus kernel-made `/proc`, `/dev`.
- BusyBox's fork sites are replaced by explicit C continuations: a child receives a copy of linear memory and inherited descriptors; `execve` replaces the Worker image but keeps the PID.
- `/bin` holds executable **descriptors** (one image, many applets), not copies.
- Users: terminals start as `user` (1000); `su root` starts a real root shell; accounts are browser-local (`desk_users.ts`).
- COOP/COEP headers are required on desk documents (the local server and generated `_headers` provide them); navigation across the desk boundary is a full document navigation.
- Desk documents permit xterm's generated `<style>` elements; script CSP is unchanged; no CDN is used.

## Window bodies and plugins

`desk/window/note.ts` handles live Markdown editing/preview and structured nbformat-4 Jupyter documents. Cells and stored output render through shared data-only adapters, with metadata-preserving edits and normal document saves. HTML/JavaScript outputs stay inert and embedded raster attachments do not require remote requests. Cell execution is not implemented. See [Notebook windows](notebooks.md).

`desk/menu/windows.ts` owns the generated Windows menu, recursive split tree and comparison drop actions. It renders only after a window-state fingerprint changes, disposes listeners with each redraw and cleans up on navigation. `desk/index.ts` owns the separate hidden flag: it hides tabs and desktop tiles, excludes hidden windows from keyboard cycling and keeps resource/process state intact. `desk/plugin/flow.ts` removes stale parent links when a child is reparented. Group persistence is not implemented yet.

`desk/menu/version.ts` recognizes only generated repository Version sources, lazily fetches public `/ID/_/refs` and `/ID/_/log` data without credentials, and disposes requests on navigation. Replies are bounded/validated by `shared/repo/history.ts`. `desk/menu/version/model.ts` owns merge nesting and fixed DAG coordinates. Named refs are resolved to commit hashes before reading history; the server returns topological parent IDs and peeled annotated tag targets. Version maps set `data-map-readonly`, preserving pan/zoom while disabling position changes. Older pages, private Work history and historical file browsing are not implemented.

`desk/menu/map.ts` owns map mode, active-menu synchronization and observer disposal; `desk/menu/map/model.ts` owns deterministic placement and zoom. `engine/tags/map.tsx` preserves metadata and fallback links. Plugins call `context.host.register_map_resources(() => ({ nodes, edges }), context.signal)`. Nodes have unique `id`, `name` and optional `info`, `icon`, `link`, `parent`, `x`, `y`, `active`, `hidden`; edges have `from`, `to` and optional `text`.

`desk/action/save/destination.ts` owns the VFS destination dialog and permission/name/overwrite checks. `desk/action/save.ts` serializes duplicate saves per shared document, preserves drafts on cancellation/failure and updates navigation after writing.

`desk/menu/map/positions.ts` validates browser-local placement records. Entry resource paths/IDs keep file-node placement stable across redraws. `desk/action/volume.ts` shares mute/level between media and remote audio; `desk/server/audio.ts` applies level through its GainNode. Optional `Window_Info.audible` comes from Electron audio-state events, so remote muted playback can still show a badge. Nested asynchronous body updates and `jazu:window-state` refresh control availability. `desk/action/fullscreen.ts` owns native fullscreen and video inactivity; `controls.ts` disposes both controllers on close/navigation.

`desk_plugins.ts` loads the plugin manifest, picks the first matching plugin/case via `plugin_types.ts`, and asks `desk_view.ts` for the body (`text`, `hex`, `folder`, `media`, `shell`, `markdown`, `default`) or a plugin script's `render`. Plugin scripts can contribute through `host.state.desk` / `host.state.windows`.

## Split conversions

Split a source window, select the child, and open the **Conversion** tab. Choose **Output MIME**, adjust its fields and click **Apply conversion** to rerun. The route appears above the controls. Parent edits automatically regenerate the child; further split descendants receive its new output. The child owns the result, with its own Save destination. Conversion options are included in browser-local desktop groups.

`desk/conversion/graph.ts` discovers the shortest executable MIME route, preferring a direct converter. `desk/conversion/index.ts` catalogs typed converter edges and their option fields; new converters declare source MIME, destination MIME, output extension and an asynchronous Blob transformation. `body.ts` handles source drafts, caching, obsolete-run cancellation and failed-step messages. An unsupported route never relabels source bytes as converted output.

Supported tools:

- Browser-decodable PNG, JPEG, WebP, GIF, BMP, AVIF, SVG and ICO to PNG, JPEG, WebP or PDF. Animated inputs produce a still image. Resize with one dimension to preserve aspect ratio, or both to choose exact dimensions; rotation is in multiples of 90 degrees. JPEG defaults to white behind transparency. Encoding is limited to 40 megapixels and depends on browser format support.
- PDF to PDF: select pages using `1,3-5`, reverse ranges with `5-3`, repeat pages, reorder them, and rotate all or selected source pages. **Split into individual pages** makes sibling output windows, up to 32 pages and 64 total desk windows. Larger PDFs can first be extracted into a smaller child PDF. Native text/vector page content is retained. Page extraction creates a new document; document-level forms, bookmarks, metadata and signatures are not preserved. The local versioned PDF-LIB module loads only when needed.
- CSV and TSV to/from JSON arrays of records. CSV↔TSV uses JSON as an intermediate. The first row supplies nonempty unique headers; quoted delimiters, escaped quotes and multiline fields work. Table fields become JSON strings; JSON values become table text (null becomes empty, nested values become JSON text). Malformed rows fail explicitly.

## <a id="artifacts"></a>Build artifacts (important)

`npm run build` **requires prebuilt WebAssembly artifacts** that are ignored by `.gitignore` (`*.wasm`, `*.tar.bz2`, `*.tar.gz`) and therefore also omitted by `npm run pack` / `codebase.zip`:

| Path | Needed file |
|---|---|
| `src/desk/busybox/artifacts/` | `busybox.wasm`, `busybox-source.tar.bz2` (plus `busybox.js`, `commands.json`, `LICENSE`, `busybox.config`, which are tracked) |
| `src/desk/programs/artifacts/` | `fastfetch.wasm`, `htop.wasm`, `tcc.wasm`; `fastfetch-source.tar.gz`, `htop-source.tar.gz`, `tcc-source.tar.bz2`, `ncurses-source.tar.gz` (plus `.js`, `.d.ts`, licenses, `tcc-sysroot.json`, which are tracked) |

If your clone lacks them, either restore them from the owner's repository/backup (the programs README calls them "checked-in artifacts", so the real repository force-tracks them) or rebuild on Linux/WSL:

```sh
bash src/desk/programs/build.sh all      # fastfetch, htop, tcc (+ ncurses); installs pinned Emscripten 4.0.20 under ~/.cache/jazu
source "$HOME/.cache/jazu/emsdk/emsdk_env.sh"
JAZU_DESK_BUILD="$HOME/.cache/jazu/busybox" bash src/desk/busybox/build.sh
```

Prerequisites: Bash, git, curl, Python 3, make, gcc, tar, bzip2, Node 22.18+, **network access** to download pinned upstream sources (SHA-256 verified).

## Adding another compiled program

1. Add its recipe and prepared artifacts under `src/desk/<program>/` (or `programs/`).
2. Add a Worker adapter `src/web/client/wasm_worker_<name>.ts` (copy `wasm_worker_htop.ts`; it calls `run_worker_runtime`).
3. Register it in `bundle_runtime()` (`engine/build/build.ts`): the list of programs with version and archive extension.
4. The image entry in `assets/wasm/manifest.json` needs `id`, `version`, `commands`, `worker`, `wasm`, `sha256`; `register_wasm()` can also register at runtime.
5. Files the program creates follow the existing `/tmp` and `/home/user` privacy rules.

## Device shell (extension bridge)

`host:` (or `pid://host`) in a window's source field starts **a shell on the machine running the browser**, through the Chromium extension in `extension/` and its native messaging host. Code: `desk_host.ts` (page side: handshake, sessions, the `host_sh` kernel program), `desk_proc.ts` (`new_host_shell`, `open_pid`; the terminal turns `convertEol` off for it), `desk_view.ts` (`terminal_hooks.uri`: "Open terminal" starts `host:` once the bridge answered, else `pid:`). `host_sh` is an ordinary process: its stdin/stdout are the window's streams, Ctrl+C is forwarded as data (`\x03`) so the device's line discipline raises SIGINT, and the terminal's size is forwarded to the pty. Without the extension the handshake fails after 2.5 s and nothing else changes. Protocol, install and threat model: [../../extension/README.md](../../extension/README.md).

## Limits to remember

Browser userland, not a Linux kernel ABI: no arbitrary native binaries, no general fork outside ash, no process groups/stop-resume signals, sockets, hard links or symlinks; `/proc` CPU/memory are placeholders; ffmpeg/ImageMagick are not bundled; `timeout` and tar's compression subprocess modes are unsupported (use `tar | gzip`). TinyCC emits i386 ELF objects, not runnable WASM.

## Verification

```sh
npm run types
npm test                      # includes tests/desk/kernel/worker.test.ts: real WASM in worker_threads
npx playwright install chromium
npm run test:desk:browser     # isolation, lazy loading, terminal, shared FS, cancellation, OPFS, programs
```

## Split document runtime

`desk_flow_rules.ts` chooses compare > convert > mirror from child picks. `desk_flow.ts` owns parent/child links, canonical mirror documents, current byte buffers, dirty state and subscriptions. Ordinary renders retain drafts; explicit new resources discard only their own buffer. Resource snapshots avoid rerendering children for a parent mode change. `desk_plugins.ts` matches `child_*` cases with `select_flow_case`; the mirror host delegates back to ordinary selection without creating a second document registry.

`desk_view.ts` publishes text/hex edits and subscribes editors to shared bytes while retaining selection and scroll. Saves capture their source and write callback and clear dirty state only for the saved revision. `desk_compare.ts` uses bounded jsdiff line comparison. `desk_preview.ts` provides sandboxed HTML and cancellable image conversion through the page's existing kernel and binary VFS. `desk_pdf.ts` dynamically imports the locally published PDF.js runtime, owns its worker/document/render lifecycle, and releases it on window replacement. `build.ts` publishes versioned PDF.js assets plus a revalidated manifest; no PDF code is bundled into the normal page runtime.

Checks: `tests/desk/plugin/flow.test.ts`, `tests/desk/plugin/compare.test.ts`, `tests/engine/tags/plugin.test.ts` and `tests/desk_split.spec.ts` cover shared drafts, save races, detach/close, flow selection, line changes, empty children, mode rules, sandboxed live HTML, actual img2pdf output and PDF canvas pixels.

## Menu options and computes

Each menu has one options strip at the bottom of its side panel. Buttons match the menu tabs' font/icon size and height; overflow scrolls horizontally with a hidden scrollbar. Group captions are centered, uppercase and subdued, with rules on both sides and dividers between buttons. API deployment and saved-desktop fields/actions share that horizontal strip instead of stacking secondary forms beneath it. File actions are grouped into Clip, New, Disk and Rename; selection changes availability without moving the file rows. Windows has New Window/Desktop, Delete and Show/Hide, with saved-desktop controls in the same strip. Sessions has New Script/Site and selected-session Start/Stop, Clear, Restart and Delete. Restart waits for the server to acknowledge Stop before sending Start, including on older personal-server images. Script states carry server start/retry timestamps; both the entry and log view update elapsed time/countdowns. Conversion and version settings also live outside the entries feed. Map always uses the northeast-arrow icon and is disabled for menus without a map.

Computes is present on every desk, including converters and fixed desks. Select `{vfs}`, create a persistent WASM computer, or connect another filesystem. Files follows that selection. WASM computers have separate directory trees and share peer filesystem access through `/net/{compute id}`. A peer's network is not re-exported, keeping recursive enumeration finite. Copy/paste and dropping files onto a compute transfer data through the existing handle adapters. Terminals and their child processes retain their original filesystem when another compute is selected. The compute catalog and ordering persist in IndexedDB; WASM files persist in a separate OPFS `.computes` area that is excluded from home-folder transfers. `/tmp` remains volatile. The active compute is remembered per browser tab. Saved folder handles restore when permission allows; otherwise activation requests a fresh grant. Drive stores only its folder ID and account email, reconnects explicitly under that account, and never persists provider access tokens. Deleting a WASM computer removes its saved files and stops its processes; disconnecting a mount preserves its source files.

Filesystem opens a source chooser: Shared folder requests a fresh browser directory grant without moving or replacing the existing home; Google Drive accepts a folder URL or ID. Drive explicitly requests filesystem consent, independently of normal login's private key-storage permission. Reads/writes use Drive v3 with pagination and in-memory access tokens; duplicate names are reported rather than guessed, delete moves entries to trash, and Google Workspace documents are exported as PDF for reading. Enable Drive API and configure the optional Drive scope in the OAuth application's consent settings before using this integration. See [Google Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) and [Drive file operations](https://developers.google.com/workspace/drive/api/reference/rest/v3). Live provider consent remains an interactive acceptance check.

On the owner-authenticated server desk, the existing configured Personal Server is another compute; it does not automatically replace `{vfs}`. Selecting it routes new terminals to the personal server; selecting a WASM compute routes them to the browser runtime. The current backend exposes one configured personal-server connection; this menu does not provision additional servers. Removing a filesystem entry disconnects it from the menu and never erases its source folder.

Google sign-in opens a popup synchronously from the user's click. The callback sets the existing secure session cookies and sends a credential-free completion signal through same-origin messaging/BroadcastChannel. The original page refreshes its session and UI without navigation or losing its windows. BroadcastChannel also handles opener separation caused by cross-origin isolation. A blocked popup reports a retryable error; no login fallback navigates the original page.

Account homes (2026-11-27): a signed-in browser account gets `/home/{username}`, where the shell-safe username is the normalized email local part plus ten SHA-256 hex characters of the canonical email. This separates identical local parts from different domains without trusting provider display names as paths or shell text. New VFS terminals use this username, `HOME` and prompt; `/etc/passwd`/`group` reflect it. Additional WASM computers retain their own anonymous user. Existing processes retain their original identity and filesystem.

In Computes, select a connected Drive folder and choose **Personal home → Use Drive folder**. The account home now points at that folder, while `/home/user` keeps its original browser files. **Use browser files** restores the alias without moving or deleting either source. Only the account email/folder ID choice is stored locally; tokens remain in memory. A saved Drive choice that cannot reconnect is unavailable, and never silently falls back to writing browser files. Every retained account directory, child file and writer checks the current account and mount generation; sign-out, account changes and switching the home revoke them even for virtual root. Sign-out/account deletion refresh other tabs through a credential-free BroadcastChannel signal. Browser tests cover the alias, Drive binding, reload, sign-out and terminal identity; unit tests also exercise retained writers and ambiguous usernames. Live Google consent remains interactive acceptance.

Verification for the 2026-11-27 continuation: root types, static generation and server build pass. The desk browser checks cover popup login, persisted computers/files, account-bound Drive restoration, shared-folder migration, notebook saves, maps, saved desktops, script restart, docking and authored Markdown. The two earlier exploratory failures are corrected: `auto` layout permits docking while `fixed` remains locked, and authored Markdown takes priority over the generic Notebook viewer. Ctrl+C preserves pending interrupts while a command's WASM worker is being replaced, wakes sleeping shells and preserves the parent shell's state. Permission checks ignore stale results after a folder handle has been replaced.

The local real Worker/browser authentication checks pass for popup code-flow initiation and account deletion. The server suite passes 73 tests with one unavailable-PTY skip; 38 isolated tests also pass on the personal server's ARM64 runtime in a temporary network-disabled container. The running production/staging images remain at `ce753a3`; Git pushes alone have not replaced those containers. Live Google/Drive consent remains interactive acceptance. Public scripted authentication probes were rejected by Cloudflare with error 1010; no Cloudflare policy was changed.
