# Desktop environment (`xinit` kiosk)

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `extension/` (`manifest.json`, `content.js`, `background.js`, `host/`), `desk/host/host.ts`, `desk/host/proc.ts` (`host:` windows)
- **Related guides:** [README → Desk Use](../../README.md#desk-use), [extension/README.md](../../extension/README.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

- [/] Independent Electron desktop: native VFS/editor save, clipboard, system volume and native-window controls exist; native window projection, full capture and Wayland input remain open. See [desktop package](../../app/README.md).
- [?] Window-manager adapters for i3, Sway, Hyprland and EWMH X11: validated discovery/place/focus/close operations. Live i3/X11 acceptance passed in an isolated ARM64 display; Sway/Hyprland device acceptance remains for review.
- [?] Native filesystem channel shared with the personal server; Windows path confinement regressions and native Electron open/save pass.

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Native messaging host: framing, strict request validation, real pty shells (python backend with resize, `script` fallback), flow control, hang-up on exit (`tests/extension/host/host.test.ts`)
- [x] Installer for the launcher and native messaging manifests; extension id derived from the manifest key (`extension/host/install.ts`, `tests/extension/host/host.test.ts`)
- [x] Page ↔ content script ↔ service worker ↔ host chain with origin allow-list, exercised in a simulated browser against the real host (`tests/desk/host/host.test.ts`)
- [x] `host:` terminal windows; "Open terminal" prefers the device shell when the bridge answers; WASM shell unchanged otherwise
- [x] Threat model written down ([extension/README.md](../../extension/README.md#threat-model))
- [ ] Verify the extension, native messaging and `/desk` in a real Chromium (not possible in the development sandbox: no browser)
- [ ] Verify `extension/xinitrc.example` on the target machine (`xinit`/`startx`, kiosk flags)
- [ ] Reattach to a shell after a page reload (shells currently end with the page)
- [ ] Optional per-session confirmation prompt before the first device shell opens

