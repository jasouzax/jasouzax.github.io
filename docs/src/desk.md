# Desktop (`desk`): runtime and WASM toolchain

The `/desk` workspace runs real GNU/Linux programs in the browser without a VM: a browser kernel, a shared filesystem, and C programs compiled to WebAssembly. Back to [site developer guide](README.md). Authoring: [../content/desk.md](../content/desk.md). Status: [../feat/desk.md](../feat/desk.md), [../feat/plugins.md](../feat/plugins.md).

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

`desk_plugins.ts` loads the plugin manifest, picks the first matching plugin/case via `plugin_types.ts`, and asks `desk_view.ts` for the body (`text`, `hex`, `folder`, `media`, `shell`, `markdown`, `default`) or a plugin script's `render`. Plugin scripts can contribute through `host.state.desk` / `host.state.windows`.

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
3. Register it in `bundle_runtime()` (`src/build.ts`): the list of programs with version and archive extension.
4. The image entry in `assets/wasm/manifest.json` needs `id`, `version`, `commands`, `worker`, `wasm`, `sha256`; `register_wasm()` can also register at runtime.
5. Files the program creates follow the existing `/tmp` and `/home/user` privacy rules.

## Device shell (extension bridge)

`host:` (or `pid://host`) in a window's source field starts **a shell on the machine running the browser**, through the Chromium extension in `extension/` and its native messaging host. Code: `desk_host.ts` (page side: handshake, sessions, the `host_sh` kernel program), `desk_proc.ts` (`new_host_shell`, `open_pid`; the terminal turns `convertEol` off for it), `desk_view.ts` (`terminal_hooks.uri`: "Open terminal" starts `host:` once the bridge answered, else `pid:`). `host_sh` is an ordinary process: its stdin/stdout are the window's streams, Ctrl+C is forwarded as data (`\x03`) so the device's line discipline raises SIGINT, and the terminal's size is forwarded to the pty. Without the extension the handshake fails after 2.5 s and nothing else changes. Protocol, install and threat model: [../../extension/README.md](../../extension/README.md).

## Limits to remember

Browser userland, not a Linux kernel ABI: no arbitrary native binaries, no general fork outside ash, no process groups/stop-resume signals, sockets, hard links or symlinks; `/proc` CPU/memory are placeholders; ffmpeg/ImageMagick are not bundled; `timeout` and tar's compression subprocess modes are unsupported (use `tar | gzip`). TinyCC emits i386 ELF objects, not runnable WASM.

## Verification

```sh
npm run types
npm test                      # includes tests/desk_wasm.test.ts: real WASM in worker_threads
npx playwright install chromium
npm run test:desk:browser     # isolation, lazy loading, terminal, shared FS, cancellation, OPFS, programs
```
