# Virtual filesystem and accounts

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `src/web/client/desk_fs.ts`, `desk_vfs.ts`, `home_directory.ts`, `memory_fs.ts`, `connect_folder.ts`, `sign.ts`
- **Related guides:** [docs/src/client.md](../src/client.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] `/home/user` backed by the visitor's browser (OPFS) or a connected local folder (File System Access API)
- [x] `/tmp` in memory only
- [x] `/bin`, `/proc`, `/dev` provided by the kernel
- [ ] Mount public `/srv` resources consistently in the browser VFS and desk window loading (3.7)
- [ ] Google Drive visitor storage, in-memory tokens and conflict copies (3.8)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 3.7 Shared virtual filesystem

**Objective.** One file tree that every desk, window, process and plugin sees, that looks like a single shared system, and that never stores a visitor's private data on the owner's servers.

**Solution.** The filesystem is an illusion built from several sources behind a mount table over a memory root: the root directory is mostly hard-coded and everything below it loads lazily, so what looks like one big shared filesystem is an accumulation of separate parts. Visitors can run `pid:` to start a shell, work with shared files such as `/srv/blogs/python/01`, and run `python sample.py`. The API is POSIX-like (`stat`, `readdir`, `read`, `write`, `mkdir`, `rm`, `rename`, `watch`) with POSIX-like errors (`ENOENT`, `EROFS`, `EACCES`). `file:///` URIs resolve into it, and menus read it with `readdir` and `watch`. This is the same tree on `/desk`, `/work`, `/projects` and every other desk.

| Mount | Backing | Writable | Persistence |
|---|---|---|---|
| `/home/user` | The visitor's own: browser file system, or a folder picked with the File System Access API, or mirrored to their Google Drive; the work repository is `/home/user/{id}` | yes | persistent, private to the visitor |
| `/srv/blogs/{id}` | Published blog files, read-only HTTP mount, lazy | in-memory overlay | vanishes on refresh |
| `/srv/events/{id}` | Published event files, same | in-memory overlay | vanishes on refresh |
| `/srv/repo/{id}` | The project's repository on the owner's server (through the API) | contributors only; others get an in-memory overlay | server for contributors |
| `/bin`, `/usr` | Stubs and data, one per plugin | persistent overlay | local |
| `/tmp` | Memory | yes | none |
| `/proc`, `/dev` | Kernel (`null`, `zero`, `random`, `tty`, process table) | | |

**Privacy rule.** New uploads and anything a window creates land in `/tmp`, so nothing private persists in the site; it is deleted when the page closes unless the visitor saves or drags it into `/home/user`. `/home/user` is accessible only to that visitor. Signed-in contributors (the owner, partners, clients on their repositories) may edit and execute inside the repositories they have rights to; everyone else has read-only views whose edits are overlays. `/desk` is strictly client side: no file bytes reach the owner's servers.

## 3.8 Accounts and persistence

**Objective.** Let visitors keep their desk and clients bind their sessions, without the owner holding visitors' files.

**Solution.** Not signed in: `/home/user` is in the browser (optionally a local folder). Signed in with Google: `/home/user` is in the user's own Drive (scopes `drive.file` for created files and `appdata` for desk state); on login, browser files can be transferred; conflicts resolve by newest modification and the loser is kept as `name (conflict DATE)`. The Drive token lives only in memory and is never sent to the owner's servers. **Save** writes into the virtual filesystem (1.4.2); downloading to the device is a file action in the menu. Preferences (theme, mode, language, recent pages, cookie notice) live in local storage; the cookie notice is a popup with JavaScript and a footer line without.
