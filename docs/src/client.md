# Browser runtime (`src/web/client`)

Plain TypeScript bundled by esbuild into IIFE scripts (classic scripts, not modules, so a wrong MIME type on `.js` cannot break them). No framework. Bundles produced by `bundle_runtime()` in `build.ts`: `page` (main), `theme_switch` (lazy), `desk_shell` (lazy shell registration), one `wasm_worker*` per program, and the inline `boot`. Back to [site developer guide](README.md).

> Some file headers still say `client_desk_*.ts`, `jazu.config.ts` or `client_proc_types.ts`: those are generation-11 names. The files are now `desk_*.ts`, `proc_types.ts`, and `google_client_id` comes from the `GOOGLE_CLIENT_ID` environment variable at build time.

## File map

| Group | Files | Role |
|---|---|---|
| Boot & loading | `boot.ts`, `loading.ts` | Inline first-paint state; skeleton lifecycle |
| Navigation | `spa.ts`, `page.ts`, `scroll.ts`, `menus.ts`, `search.ts`, `pager.ts` | SPA swaps, tab spy, dropdown filters, clipboard, expertise search, slide pager |
| Expertise | `expertise.ts` | Scroll-snap slider ↔ URL fragment state (CSS `:target` is the state machine) |
| Themes | `theme_switch.ts` | Lazy theme load, fade, rollback |
| Accounts | `sign.ts`, `connect_folder.ts`, `home_directory.ts`, `memory_fs.ts` | Google sign-in popup, local folder mount, OPFS home, memory-only handles |
| Desk windows | `desk.ts`, `desk_view.ts`, `desk_folder*.ts`, `desk_media.ts`, `desk_markdown.ts`, `desk_previews.ts`, `desk_syntax.ts`, `desk_mime.ts`, `desk_navigation.ts`, `desk_selection.ts`, `desk_files_util.ts`, `desk_paths.ts`, `desk_plugins.ts`, `desk_flow.ts`, `desk_flow_rules.ts` | See [desk.md](desk.md) |
| Filesystem | `desk_fs.ts`, `desk_fs_permissions.ts`, `desk_vfs.ts` | The file tree and its POSIX-like view for processes |
| Processes | `kernel.ts`, `proc_types.ts`, `desk_proc.ts`, `desk_shell.ts`, `desk_users.ts`, `wasm_*.ts` | Kernel, shell, WASM workers |
| Print | `print.ts` | Date/age refresh on `beforeprint` |

## Boot, theme and loading lifecycle

1. The **inline boot script** (`boot.ts`, hashed into the CSP) adds the `js` class, marks the intro, restores `data-theme`/`data-mode` from local storage, and loads the real theme stylesheet **without blocking**. It fails open if a stylesheet is unavailable (restrictive extensions): the inline layout stays usable with system fonts.
2. Inline boot captures fixed placeholder rectangles **before** the theme activates, so fonts and theme geometry cannot move the skeleton. Each placeholder has its own moving shine layer.
3. When resources settle, complementary diagonal masks remove the placeholders and reveal the content while the neutral backdrop fades into the theme colour; the background renderer starts afterwards. Content already in view skips its entrance animation. Visible images and fonts get a bounded readiness wait.
4. **SPA page swaps** preserve the existing signature SVG. **Theme changes** pass through the neutral layout, remove the previous font stylesheet, and restore the previous theme on failure. Reduced motion and paused motion stop shimmer/wipes. Without JavaScript pages use ordinary stylesheet links.
5. `html.theme_ready` marks the theme as loaded.

Verify with `npm run build` followed by `npm run test:loading:browser` (needs Playwright's Chromium).

## SPA navigation (`spa.ts`)

Eligible click = plain left click on a same-origin link (`should_intercept`): modified clicks, `target`, `download` and `/api` links are never intercepted. It fetches `{path}/index.json` (3 s timeout; on failure it navigates normally), swaps title/SEO tags/breadcrumbs/tabs/actions and main (built with `to_dom` from the vnode tree), updates history, moves focus to the main heading with a polite announcement, restores scroll, never replays the intro, rehydrates desk and expertise, and prefetches on hover/focus when allowed.

## Header menus and search

Dropdowns order by recent visits (local only, up to 50). Search reads `assets/nav_index.json` (path, name, info, rank, language) with a scored subsequence match; the expertise search (`search.ts`) filters timeline, dots and slides client-side across all skills.

## Filesystem and accounts

- `/home/user` belongs to the visitor: browser private storage (OPFS) by default. **Connect with Folder** (account menu) mounts a chosen local folder through the File System Access API. Existing home entries are copied into it; collisions get ` (N)` before the extension; existing directory trees stay intact; originals remain in private storage as backup. New files, saves, uploads, moves, deletes, shell writes and preview caches then use the chosen folder. Connections are remembered in IndexedDB; a browser may require re-selecting the folder. Missing permission disables file creation instead of falling back to stale private storage. Browsers without the directory picker show the action disabled. Requires a secure context (HTTPS or localhost).
- `/tmp` is **memory only**; uploads land there (`memory_fs.ts` opens no OPFS/IndexedDB/localStorage/network).
- `/srv` is public published resources (read-only; in-memory overlay for edits). Consistent browser mounting of `/srv` is unfinished ([status](../feat/filesystem.md)).
- `/proc`, `/dev`, `/bin` come from the kernel.
- Previews: PNGs under `/home/user/.cache/previews`, lazily generated, limited to 256 entries; never cached for their own cache folder.

## Known gaps

`innerHTML` assignments remain in `pager.ts`, `search.ts`, `desk.ts`, `desk_markdown.ts` (Markdown is rendered with HTML disabled). Cloud features (Google Drive storage, Work client) are unimplemented ([status](../feat/filesystem.md), [work](../feat/work.md)).
