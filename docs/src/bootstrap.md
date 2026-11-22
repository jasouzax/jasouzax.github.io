# Dependency and extension steps

`node src/main.ts inst` runs `npm ci` using only Node builtins before importing tsx. It can precede other commands: `node src/main.ts inst test:ts ext`. Run it from the checkout root. Node 22.18 or newer and npm are prerequisites.

`node src/main.ts ext` produces `.cache/extension/` for Chromium's Load unpacked action. The manifest's signing key and origin allowlist are preserved. The extension is plain JavaScript, so packaging requires no transpilation. Install its native host with `node .cache/extension/host/install.ts` on the target Linux device. Browser acceptance and a real kiosk session still require human verification.

The pipeline accepts `inst` and `ext`, including forward ranges. `all` includes these steps. Extension packaging was exercised locally; the pipeline syntax regression and TypeScript validation cover command composition. A clean installation still requires network access to npm.
