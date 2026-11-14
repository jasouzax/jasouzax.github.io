# PWA, offline snapshot and notifications

Source: `src/pwa.ts` (build), `src/web/pwa_worker.ts` (service worker), `src/web/client/{pwa,notifications,realtime}.ts` (page), `src/web/notification_{store,preview}.ts` (shared), `src/node/push{,_keys}.ts` (server), `migrations/0008_push.sql`.

## Status
Implemented in code but **unverified**: no dependencies or network were available when this was finished, so no checkbox below is evidence of a passing run; tick them only after the commands in the unchecked items succeed.
- [x] `config.json` `pwa` block (validated by `src/config.ts`) is copied to `manifest.json` under `jazu.pwa`; icons, colours, display and shortcuts come from `seo` in the same file
- [x] Service worker generated at build time with a SHA-256 allowlist of public output (pages in every language, both themes, fonts, artwork); `offline.json` lists it
- [x] Excluded from the snapshot: `/api/`, `_*`/dot files, `*.git/`, `pwa.exclude_prefixes` (default `/assets/wasm/` = Desk toolchains) and expertise media/posters (`exclude_expertise_media`)
- [x] Installation fetches canonical URLs (`/x/` for `/x/index.html`, because Pages redirects the latter), verifies each revision hash and deletes the whole cache on any mismatch; old snapshots are deleted on activation
- [x] Offline banner; Desk is disabled while offline (`html[data-offline]`)
- [x] Notifications show `{email}` (low opacity in the page, title in native alerts) above the **decrypted** message. The device key is loaded after the page loads (`init_notification_keys`) and persisted as a non-extractable `CryptoKey` in IndexedDB; no plaintext is stored
- [x] Web Push: VAPID-signed, payload holds routing metadata only (never text); the worker fetches ciphertext from `/api/v1/push/message` and decrypts locally; unreadable messages fall back to a generic line
- [x] Subscriptions are per session, capped at 8 devices, removed on sign-out/account deletion, on 404/410 and after 30 days of session inactivity; receipts prevent duplicates and failed devices are retried
- [ ] Run `npm run types`, `npm test` (`tests/pwa.test.ts`, `tests/push.test.ts`) and `npm run test:pwa:browser` on a machine with dependencies; nothing here has been executed yet
- [ ] Verify real Web Push on Chrome/Android, Firefox and iOS (home-screen install required) against staging
- [ ] Apply migration 0008 and VAPID secrets to staging (`npm run push:keys`, then `npm run tf:staging -- apply`)

## Contract
- Public snapshots never contain API responses, cookies, messages or keys. `Desk` (WASM, files) and messaging need a connection.
- Navigations are network-first so online visitors get new releases; a new worker waits until old documents close.
- `VAPID_*` is a persistent pair independent of conversation keys. Never regenerate it while subscriptions exist; `push_keys.ts` refuses to replace one.
- Add PWA options to `config.json` + `src/config.ts` only; the manifest picks them up from `jazu.pwa`.
