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
- [x] Shared-key encrypted text chat: owner-created invitations, tenant authorization, idempotent sends, catch-up polling, invitation revocation and `message/cpim` / `im:` windows
- [ ] Google JWT verification, UUID claim, hashed cookie sessions, tenant filtering, CSRF and rate limits (4.5)
- [ ] Chat idempotency, reconnect, soft deletion, file upload policy, owner audit and mail debounce (4.6)
- [ ] Per-client durable chat and database API adapters
- [ ] Work client: sessions, messages, pins, receipts, dashboards and state versioning (3.9)

## Contract

## Encrypted messaging implementation

`/work` opens a `message/cpim` window at `im:jason@jasouza.com`. The owner uses the same page and selects a client; the window address becomes `im:{client email}`. This MIME identifies the conversation viewer; the transport is encrypted JSON, not an interoperable CPIM/SIP service.

This first release uses owner-created bearer invitations. The Google/UUID cookie-session design below remains planned. Configure a random `WORK_OWNER_TOKEN` (32–256 URL-safe characters) as a Worker secret. Open **Owner access**, enter that token, then create a conversation with the client's email. **Invitation link** exposes the link to copy, back up privately and share through a trusted channel. The same link lets the owner restore the key after signing in on another device; a raw shared key also works. No email is sent automatically.

The browser generates a random 256-bit shared key and encrypts each message with AES-GCM, a fresh 96-bit IV and a 128-bit authentication tag. Additional authenticated data binds protocol version, room, message UUID and authenticated author. The server stores encrypted message envelopes; keys never enter HTTP requests or server storage. Email, author, timestamps and ciphertext lengths remain visible to the service. Shared keys provide no forward secrecy or protection against compromised devices or malicious site JavaScript. Anyone holding an invitation can read history and send as that client. The server cannot recover lost keys.

Invitation secrets travel in the URL fragment, which is removed from browser history after import. They are kept in tab session storage; plaintext drafts and pending sends stay in memory only. **Lock workspace** clears the tab's invitations and owner token: keep an external private backup first. Owner-created invitations do not silently reopen as the client after reload; the owner must authenticate again. Closing a conversation revokes its client token and prevents further sends; the owner retains read access. Reopening/key rotation is not implemented.

The Worker authenticates each request, derives the author, enforces same-origin mutations and a custom header, accepts bounded ciphertext only, and stores client token hashes in D1. Clients cannot list rooms or access other clients. Sends have UUID idempotency and a durable 30-message/minute/role/room limit. The browser retains an unacknowledged encrypted envelope for explicit retry, polls every five seconds with backoff to thirty, and catches up by database sequence, 100 messages per page. Messaging works with the personal server offline. Google sign-in, cookie sessions, WebSockets, attachments, edits/deletes, audit and notification email remain future work.

Code: `src/work_crypto.ts`, `src/node/work.ts`, `src/web/client/desk_messages.ts`, `migrations/0002_work_chat.sql`. Tests: `tests/work.test.ts`; `npm run db:local` then `npm run test:work:browser` exercises separate owner/client contexts against local Worker/D1, including a lost acknowledgement and safe retry.

### Staging setup

Set `WORK_OWNER_TOKEN` in the provisioning machine's private `.env` (generate using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Run `npm run tf:staging -- plan` / `apply` from the `staging` checkout. Its standalone root creates `jazu-staging-work`, applies SQL migrations and binds D1/the secret to the staging Worker. Production resources are untouched. An empty owner token disables chat with `503`. Publish the static shell through staging CI. Locally, put the secret in `.dev.vars`, then run `npm run db:local`, `npm run serve`, and `npm run cloud:dev`. Never deploy the local Wrangler config.

Verified locally: TypeScript, Work crypto/SQL/authorization tests, adjacent Worker/plugin tests, staging Terraform validation/mocked tests, and a desktop-owner/mobile-client browser test against real local Worker/D1. The browser test checks both addresses, bidirectional encrypted text, a lost send acknowledgement with deduplicated retry, history after reload, inert HTML text rendering and mobile width. The full Windows suite reported existing WASM toolchain failures and pipeline timeouts under concurrent load; the targeted listener timeout case passed on rerun.

Suggested next features: verified account sign-in, encrypted attachments with size limits, read/unread indicators, browser-side history search and secure invitation rotation/device management.

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
