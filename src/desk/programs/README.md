# Browser programs

These are compiled upstream C programs, executed in separate Web Workers through
the same filesystem, terminal, process table, pipes, and integrity-checked loader
as BusyBox. The sources and license notices accompany the published WASMs.

| Program | Upstream version | Browser port |
| --- | --- | --- |
| Fastfetch | 2.40.4 | Linux/proc detectors backed by the browser kernel; inaccessible hardware modules remain unavailable. |
| Htop | 3.4.1, Ncurses 6.5 | Portable platform backend populated from the actual browser process table. Keyboard input, refresh, filtering, and process termination use the shared terminal and kernel. |
| TinyCC | 0.9.27 | i386 cross-compiler running in WASM, with bundled C headers. Produces native ELF objects; it does **not** generate runnable WebAssembly or support native `-run` in the browser. |

For example:

```sh
fastfetch --logo none
htop                 # q exits
printf '#include <stdio.h>\nint add(int x) { return x + 7; }\n' > hello.c
tcc -c hello.c -o hello.o
```

System information describes the browser sandbox, not a Linux host machine.
Memory totals use the JavaScript heap budget where the browser exposes it.
Per-process CPU and memory accounting is unavailable and displayed as zero;
hardware, network-interface, and scheduler controls unavailable to the browser
are not simulated as host capabilities.

## Users and persistence

Terminals start as `user` (UID/GID 1000). `su root` starts a real child shell with
UID/GID 0; `exit` returns to the original user. Accounts are browser-local and
passwordless. `whoami`, `id`, and `groups` use the process credentials and
`/etc/passwd`/`/etc/group`. Root can add or remove temporary accounts with
`useradd -m guest` and `userdel -r guest`, then use `su guest`.

Root may change or remove directories such as `/srv` and files under `/etc`.
System files, user records, compiler headers, ownership metadata, and `/tmp` are
kept in memory and reset on a full page reload. Only changes inside
`/home/user` are persistent. Deleting `/home/user/hello.txt` really removes that
persistent file; deleting `/srv` does not touch a server or the computer's root
filesystem and is undone by reloading the page.

## Rebuilding in WSL

From a WSL shell in the repository:

```sh
bash src/desk/programs/build.sh all
source "$HOME/.cache/jazu/emsdk/emsdk_env.sh"
JAZU_DESK_BUILD="$HOME/.cache/jazu/busybox" bash src/desk/busybox/build.sh
```

The recipe pins Emscripten 4.0.20 and checks upstream archive SHA-256 hashes.
`port.py` contains explicit, reproducible platform changes. Build caches and the
SDK live under `~/.cache/jazu` so restarting WSL does not discard them. Artifacts,
source archives, the compiler header bundle, and license notices are stored in
`artifacts/`. A normal website build consumes these checked-in artifacts without
compiling C or requiring WSL.
