# PWA, offline snapshot and notifications

Source: `engine/routes/{sw.js.ts,offline.html.tsx}` (build), `desk/site/{service_worker,pwa,notifications}.ts` (page/worker), `desk/work/realtime.ts`, `shared/notification/{store,preview}.ts`, `cloud/api/push.ts`, `cloud/db/migrations/0008_push.sql`.

## Status
Public offline browsing and online-only workspace exclusions are implemented and verified locally. Real-device installation and browser-closed delivery remain acceptance checks against staging.
- [?] Offline public snapshots and both themes load in real Chrome; /desk, /server and /work (including language variants and JSON payloads) stay out of CacheStorage. Offline navigation to these paths shows a script-free connection-required page while preserving the requested URL for retry.
- [x] `config.json` `pwa` block (validated by `shared/config.ts`) is copied to `manifest.json` under `jazu.pwa`; icons, colours, display and shortcuts come from `seo` in the same file
- [x] Service worker generated at build time with a SHA-256 allowlist of public output (pages in every language, both themes, fonts, artwork); `offline.json` lists it
- [x] Excluded from the snapshot: `/api/`, `_*`/dot files, `*.git/`, `pwa.exclude_prefixes` (default `/assets/wasm/` = Desk toolchains) and expertise media/posters (`exclude_expertise_media`)
- [x] Installation fetches canonical URLs (`/x/` for `/x/index.html`, because Pages redirects the latter), verifies each revision hash and deletes the whole cache on any mismatch; old snapshots are deleted on activation
- [x] Offline banner; Desk is disabled while offline (`html[data-offline]`)
- [x] Notifications show `{email}` (low opacity in the page, title in native alerts) above the **decrypted** message. The device key is loaded after the page loads (`init_notification_keys`) and persisted as a non-extractable `CryptoKey` in IndexedDB; no plaintext is stored
- [x] Web Push: VAPID-signed, payload holds routing metadata only (never text); the worker fetches ciphertext from `/api/_/push/message` and decrypts locally; unreadable messages fall back to a generic line
- [x] Subscriptions are per session, capped at 8 devices, removed on sign-out/account deletion, on 404/410 and after 30 days of session inactivity; receipts prevent duplicates and failed devices are retried
- [?] Root types, focused snapshot/push checks and Chrome offline navigation pass. The snapshot excludes its own service worker/manifest and private routes; revision verification and atomic install remain enforced.
- [ ] Verify real Web Push on Chrome/Android, Firefox and iOS (home-screen install required) against staging
- [ ] Apply migration 0008 and VAPID secrets to staging (`npm run push:keys`, then `npm run tf:staging -- apply`)

## Contract
- Public snapshots never contain API responses, cookies, messages or keys. `Desk` (WASM, files) and messaging need a connection.
- Online-only navigation uses the network and falls back to `/offline.html` on connection failure. JSON requests for those routes are never served from CacheStorage; SPA navigation can fall through to the same offline document. Public project/blog documents remain available offline. The fallback has no scripts, account state or file handles.
- Navigations are network-first so online visitors get new releases; a new worker waits until old documents close.
- `VAPID_*` is a persistent pair independent of conversation keys. Never regenerate it while subscriptions exist; `push_keys.ts` refuses to replace one.
- Add PWA options to `config.json` + `shared/config.ts` only; the manifest picks them up from `jazu.pwa`.
