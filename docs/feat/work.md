# Work portal (client workspace)

> Status checklist and technical contract. Overview of all features: [README.md](README.md). Developer entry: [../README.md](../README.md).

- **Code:** `content/work.xml`, `src/node/worker.ts`, `migrations/0001_work.sql`
- **Related guides:** [docs/src/node.md](../src/node.md)
- **Component numbers** such as `1.4` are stable ids used across the docs (index in [README.md](README.md#component-number-index)).

## Status

`[x]` implemented and verified, `[ ]` still to do, `~~struck~~` cancelled or superseded. A checked parent needs all its children checked.

- [x] Static `/work` shell served with `no-referrer`/`no-store`
- [x] D1 schema and migration for clients, sessions, messages, files, receipts, pins, dashboards, desk state and audit; tests enforce idempotency and cross-tenant pin constraints
- [x] Unfinished work APIs return `501` and accept no client data
- [ ] Google JWT verification, UUID claim, hashed cookie sessions, tenant filtering, CSRF and rate limits (4.5)
- [ ] Chat idempotency, reconnect, soft deletion, file upload policy, owner audit and mail debounce (4.6)
- [ ] Per-client durable chat and database API adapters
- [ ] Work client: sessions, messages, pins, receipts, dashboards and state versioning (3.9)

## Contract

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.8 Work page

**Objective.** Give every client one URL for messages, shared files, dashboards, quotations and receipts, while the owner never compiles or stores any client data into the website.

**Solution.** One path, `/work` (or `/work?uuid={uuid}`), with no subpages. It is a static shell with `<desk server="true">`; everything about a client is client-side at runtime from the API (4.3), so nothing is compiled. On first use the client gets an empty work repository, which they see as `/home/user/{id}`; they may move it anywhere in their filesystem, because the virtual filesystem only remaps it and the real repository never changes directory. Menu tabs: **Files** (the repository), **Dashboard** (live project status), **Quotation** (receipts table). The main window is the message stream; files, dashboard segments and quotations can be embedded in messages and pinned as new `view` windows. The owner signs in and the same page shows a menu of all clients (no separate admin path); the owner's own desk state per client is restored.

Sessions: the owner prints a QR code containing `/work?uuid={uuid}` after pre-labelling the client; opening it creates a device session cookie; the client can later sign in with Google to bind the record to the account, after which the UUID alone only shows the name and a sign-in prompt. Merging rule when a Google sign-in meets a UUID session: if one record is empty keep the other; if both have content, refuse and let the owner merge manually. Runtime details are in 3.9 and 4.5.

## 3.9 Work client

**Objective.** The client-side half of `/work` (1.8).

**Solution.** Claims a UUID, creates the empty work repository as `/home/user/{id}` (remappable anywhere in the virtual filesystem), shows the limited view until sign-in, runs the message window (WebSocket with a polling fallback of 5 s backing off to 30 s, idempotent sends, catch-up after reconnect), embeds and pins components as windows, renders the Quotation and Dashboard tabs from the API, and saves the client's or admin's desk state with optimistic concurrency.

## 4.5 Authentication and authorization

**Objective.** Identify clients and the owner without passwords and without tenants seeing each other.

**Solution.** Google Identity Services in the browser; the Worker verifies the ID token (signature, audience, expiry) and finds or creates the client by Google subject, merging with a UUID session under the rule in 1.8 or answering `409`. The owner is a Google subject on an allow-list kept as a Worker secret. The session cookie is `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, holds an opaque id whose hash is stored, and expires after 30 idle days. Mutating requests need a custom header. Every query is filtered by the client id derived from the session, never from client input (except for the owner). The UUID is a bearer secret (122 random bits); the URL is rewritten to `/work` after the cookie is set and the owner can rotate it. The owner's actions are written to `admin_audit`.

## 4.6 Chat

**Objective.** Real-time messaging that keeps working when the personal server is down.

**Solution.** The database is the source of truth; the durable object only fans out and tracks presence. A client socket sends a message with a client-generated id (idempotency), the room inserts it, acknowledges, and broadcasts to every socket of that client including the owner's. Reconnecting fetches `after={last_id}`. Edits and deletes are soft. The owner is notified by email through a debounced send (at most one per client per ten minutes).
