# JAZU Desktop

Independent Electron desktop; it never imports or starts the personal server.

From the checkout root, run `npm --prefix app ci`, then `node src/main.ts app` (`--kiosk` for fullscreen). The CLI builds the desktop and serves the site's static output on a random loopback port. Closing the app stops that server. To use an already running local site: `JAZU_APP_URL=http://localhost:8080/desk npm --prefix app start`.

The sandboxed renderer has no Node integration. Its isolated preload relays only the existing `jazu-host` message envelope; the main process accepts messages only from the pinned top-level localhost frame. Native host sessions use the same framing, validation and PTY implementation as the extension (`shared/host/`). Linux requires Python 3 or util-linux `script`. Navigation to another origin is blocked; new links open externally. Reloading closes native terminals.

Native filesystem mounts, compositor window placement, global input and audio/clipboard integration remain incomplete. Windows can display the desktop and use the browser WASM shell but has no native PTY backend. This package is not a replacement for a verified Linux kiosk installation.

Validation: root and app TypeScript checks, package build, root import boundaries and host protocol regressions pass. `npm run test:app` launches real Electron and verifies the desk loads, Node integration is absent, the preload handshake works and external navigation is blocked. Both compiled native PTY backends passed on the ARM64 personal server from a temporary directory, removed afterwards; no running service was changed. The host OS has Node 20, so direct TypeScript host scripts need a newer Node or a compiled runtime.

Final verification notice: the initial real Electron smoke passed, but two repeated final launches timed out before Playwright attached to Electron. The package still typechecks/builds. Launch reliability is unresolved and is marked `[!]` in `COMPONENTS.md`; do not treat the earlier successful smoke as a stable acceptance result.
