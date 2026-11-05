# Desk WASM programs

The desktop runs BusyBox **ash**, compiled from BusyBox 1.36.1. There is no
JavaScript command parser or replacement implementation of its utilities.

Run `npm ci`, `npm run build`, and `npm run serve`. Open `/desk` directly and
enter `pid:` (or `pid://sh`) in a window's source field. Commands such as
`touch /tmp/example`, `ls /tmp`, and `cat /tmp/example` operate on the same tree
as the file manager. `/home/user` uses visitor OPFS; `/tmp` stays in memory.
The build includes the prepared artifacts, so normal site builds need no C SDK.

## Rebuild BusyBox

On Linux, or inside WSL on Windows:

```sh
bash src/desk/busybox/build.sh
```

The script installs pinned Emscripten 4.0.20 if `emcc` is unavailable, verifies
the BusyBox source archive, applies `port.py`, compiles it, and runs `package.ts`
to adapt the generated loader to ESM and obtain the real applet list. An
existing compiler must be that pinned version. Build prerequisites are Bash,
git, curl, Python 3, make, gcc, tar, bzip2 and Node 22.18+.
Set `JAZU_DESK_BUILD` to keep downloaded sources/SDK outside the repository.
The default is the ignored `busybox/.build` directory. Prepared artifacts,
configuration, license, original source archive, and the port are kept together.
The site publishes the source archive and port alongside the module.

## Runtime boundary

- `wasm_host.ts` registers versioned executable images, verifies SHA-256 before
  compilation, caches modules, and services kernel requests. The image manifest
  selects a Worker adapter for each program. `/bin` contains executable
  descriptors, not separate copies of BusyBox for every applet.
- `wasm_worker.ts` instantiates BusyBox per process. Its Emscripten filesystem
  backend sends synchronous requests to the main-thread kernel through a
  SharedArrayBuffer mailbox. The UI services these requests asynchronously;
  Atomics.wait is used **only inside Workers**. File data is not preloaded or
  synchronized back from a second filesystem.
- The ash port replaces its fork sites with explicit C child continuations.
  A child receives a copy of linear memory and inherited descriptor references,
  preserving functions, variables, parsed syntax, command substitution,
  subshells, pipelines and background jobs. `execve` replaces the Worker image
  while retaining the same kernel PID. `waitpid`, `kill`, `getpid`, `getppid`,
  and BusyBox's utility spawn helper call the kernel.
- Kernel descriptors carry byte queues for pipes, shared file offsets, and
  terminal state. Filesystem reads/writes use bytes; terminal decoding is a
  display boundary. The kernel provides `/proc` records for compiled `ps` and
  `/dev/null`, `/dev/zero`, `/dev/random`, `/dev/urandom` and terminal streams.
- The window uses local xterm.js, including raw input, ANSI escapes, alternate
  screens and resize notifications. Native controlling-terminal process-group
  ioctls are disabled in ash; the kernel routes Ctrl+C and manages cancellation.

Desk documents and the Worker response require COOP/COEP isolation headers.
The local server and generated Pages headers provide them. Navigation across
the desk boundary performs a full document navigation. xterm's DOM renderer
requires generated style elements, permitted only on desk documents; script
execution retains the existing CSP restrictions. No CDN is involved.

## Adding another compiled program

Add its build recipe and prepared artifacts below `src/desk/<program>`. Publish
an image entry with `id`, `version`, `commands`, `worker`, `wasm`, and `sha256`
in the generated `/assets/wasm/manifest.json`. `register_wasm` also supports
registration at runtime. The Worker adapter implements `worker_start` and the
kernel mailbox protocol in `wasm_protocol.ts`; different Emscripten glue or WASI
modules can provide different adapters. They reuse the same filesystem,
descriptors, process table and cancellation boundary. Files created by programs
follow the existing `/tmp` and `/home/user` privacy rules.

## Current limits

This is a browser userland with a ported shell, not a Linux kernel ABI. Arbitrary
native binaries, general-purpose fork outside the explicit ash continuations,
POSIX process groups, stop/resume signals, sockets, hard links and symlinks are
not implemented. Consequently some BusyBox flags needing those facilities
(for example `timeout` and tar's subprocess compression modes) remain unsupported;
use explicit `tar | gzip` pipelines. CPU/memory fields in `/proc` are placeholders,
not measurements. htop, ffmpeg and ImageMagick are not bundled. Shell session
restoration and persistent Unix permission metadata remain future work.

## Verification

```sh
npm run types
npm test
npx playwright install chromium
npm run test:desk:browser
```

`desk_wasm.test.ts` executes the actual WASM in worker_threads. The Chromium
test covers isolation, lazy loading, terminal interaction, shared file-manager
updates, cancellation, nested interactive shells, ANSI output, OPFS persistence
and temporary-file expiry. No test substitutes a JavaScript shell.
