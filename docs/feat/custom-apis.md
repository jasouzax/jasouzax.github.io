# Custom APIs

- [?] Phase 1 core: versioned child processes, manifests and signed gateway, JSON envelopes/REST/QUERY, server-owned tokens/scopes/rate/schema checks, SQLite, deploy/rollback, secrets and audit logs.
- [?] Phase 2: jobs/idempotency, verified hooks, outbound webhooks and API client.
- [?] Phase 3: SSE/WebSocket channels, resume and tickets.
- [?] Phase 4: pub/sub, OpenAPI/typed clients and log streaming.
- [/] Phase 5: activation-gated MQTT bridge implemented; Durable Object transport and per-owner origins remain.
- [?] Desk Sessions deployment, rollback, stop and version status, with owner/CSRF enforcement.
- [ ] Multi-server registration.

Core evidence: real subprocess/SQLite/HTTP tests and real workerd routing pass, including side-by-side versions, crash/restart durability, failed candidate preservation, rollback, scopes/revocation, limits, schemas, HMAC replay and cookie isolation. Root/server types and server build pass. Existing unversioned public API dispatch is removed; the old browser VM code remains internal pending automation migration. Production services, DNS, cloud state and credentials were not changed.

Compiled Node acceptance also passes in an ephemeral, network-disabled ARM64 container on the personal server: separate processes, shared SQLite durability, rollback and supervisor restart. Temporary files were removed; running containers were unchanged.

Operator instructions and code map: [custom API guide](../src/custom-apis.md). Architectural decisions: [APISERVER.md](../../APISERVER.md). The parent stays incomplete while Durable Object transport, per-owner origins and multi-server registration remain absent.

Phase 2 evidence (2026-11-24): all 13 focused API/gateway tests and root types pass. Real HTTP/workerd/child tests cover exact-body verification before replay, durable outbound deduplication and retries, redirect refusal and API.open. Network-disabled ARM64 acceptance covers forced watchdog recovery and interrupted requests/jobs.

Continuation (2026-11-24): real child/HTTP SSE delivery, replay/cancellation and real workerd WebSocket messages pass. Runtime checks cover token revocation, scopes, owner-session binding, one-use tickets, expired cursors, bounded messages/history and socket cleanup. Schema/client generation, pub/sub and explicit log records pass. A real TCP MQTT 5 peer verifies activation, isolated exact topics, fragmented packets, JSON rejection and publication. The owner Sessions browser regression passes for rollback, failed candidate preservation, draft persistence and stopping a version. These results do not verify the missing Phase 5 capabilities or a production deployment.

Final verification: all 25 focused API/gateway/layout checks and all 19 server/Windows-menu browser checks pass. Root/server types and the server/static builds pass. Six final stream/workerd checks verify close-handshake cleanup using Worker waitUntil; 17 router/security/layout checks pass after that change. The broad Windows suite reports 341 passes, four skips and one transient EPERM mirror-rename failure whose isolated rerun passes; all 44 isolated WASM and 72 server checks pass (one PTY skip). The temporary network-disabled ARM64 container verifies stream replay, socket messages, OpenAPI and restart behavior; its uploaded files were removed.
