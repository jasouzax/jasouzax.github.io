# Public server rendering

- [?] The signed personal origin generates a public HTML template and bounded fastfetch JSON with a structure revision.
- [?] The existing Server_Hub Durable Object persists template/data atomically, refreshes public JSON once per minute, and fetches HTML only when its revision changes.
- [?] Unavailable/invalid origins preserve the last good rendered snapshot, label it cached and throttle origin retries; an empty cache keeps the static page.
- [?] Main/language HTML and SPA JSON receive the same inert public status; conditional static ETags are removed and HEAD returns representation headers without a body.
- [?] Node HTTP/HMAC and actual workerd/SQLite Durable Object tests cover fresh/offline behavior and origin credential isolation.

`server/render/status.ts` owns the origin template and `/render/server/{template,data}` behind the existing signed loopback listener. `cloud/render/status.ts` owns Durable Object persistence, `cloud/render/page.ts` assembles the Pages shell, and `shared/render/status.ts` bounds public data and escapes interpolated text. No new Durable Object class, database migration or secrets are needed. Existing `PERSONAL_ORIGIN`, `ORIGIN_HMAC_SECRET` and optional Access service-token bindings are used. Deploy the matching Node listener and Worker together to enable this path. This revision has not been deployed to production.

Only the built-in public fastfetch modules are requested: no account name, local IP, credential, repository path, terminal, script or owner data enters these responses. Public `/server` pages are indexable; owner interaction still uses authenticated APIs and is never part of the cached HTML. The renderer does not read visitor cookies. A failed server cannot prevent static Pages from being returned. One origin refresh may wait up to 12 seconds; a failed refresh is retried no more than once per minute.

The original browser fastfetch API continues to upgrade the public page after JavaScript starts. Server-side content remains useful to crawlers and readers without JavaScript. Additional public AIoT metrics require an explicitly authored public projection; private owner resources must never be added to this template.

Verification on 2026-11-23: Node HTTP/HMAC contracts and the real Windows workerd/SQLite Durable Object check pass. Twenty origin/cache/scene/book/filesystem checks pass in an isolated Node 24 ARM64 container on the personal server. Its local workerd executable cannot reserve its required virtual address space (TCMalloc); that failed emulator attempt is not a production Worker deployment. Existing services were left running unchanged, and temporary source/dependency archives were removed afterward.
