# Custom APIs

- [?] Phase 1 core: versioned child processes, manifests and signed gateway, JSON envelopes/REST/QUERY, server-owned tokens/scopes/rate/schema checks, SQLite, deploy/rollback, secrets and audit logs.
- [?] Phase 2: jobs/idempotency, verified hooks, outbound webhooks and API client.
- [ ] Phase 3: SSE/WebSocket channels, resume and tickets.
- [ ] Phase 4: pub/sub, OpenAPI/typed clients and log streaming.
- [ ] Phase 5: Durable Object/MQTT live layer and per-owner origins.
- [ ] Multi-server registration and desk Sessions deployment controls.

Core evidence: real subprocess/SQLite/HTTP tests and real workerd routing pass, including side-by-side versions, crash/restart durability, failed candidate preservation, rollback, scopes/revocation, limits, schemas, HMAC replay and cookie isolation. Root/server types and server build pass. Existing unversioned public API dispatch is removed; the old browser VM code remains internal pending automation migration. Production services, DNS, cloud state and credentials were not changed.

Compiled Node acceptance also passes in an ephemeral, network-disabled ARM64 container on the personal server: separate processes, shared SQLite durability, rollback and supervisor restart. Temporary files were removed; running containers were unchanged.

Operator instructions and code map: [custom API guide](../src/custom-apis.md). Architectural decisions: [APISERVER.md](../../APISERVER.md). The parent stays incomplete while later phases and multi-server/desk integration remain absent.

Phase 2 evidence (2026-11-24): all 13 focused API/gateway tests and root types pass. Real HTTP/workerd/child tests cover exact-body verification before replay, durable outbound deduplication and retries, redirect refusal and API.open. Network-disabled ARM64 acceptance covers forced watchdog recovery and interrupted requests/jobs.
