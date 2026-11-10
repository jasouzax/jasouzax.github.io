# Desktop environment (`xinit` kiosk)

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** *(nothing yet)*
- **Related guides:** [README → Desk Use](../../README.md#desk-use-todo)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [ ] Document and script the `xinit` + X server session that starts Chromium in kiosk/app mode on `localhost`
- [ ] Chromium extension that bridges the page to the device shell
- [ ] Localhost ↔ extension ↔ device-shell channel (not yet developed)
- [ ] Threat model: why the desktop stays on `localhost`, never on a public domain
