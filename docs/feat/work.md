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
- [x] Google OIDC code flow, verified identities, pinned admin subject, hashed HttpOnly sessions, CSRF, sign-out and invitation-to-Google linking
- [ ] Google JWT verification, UUID claim, hashed cookie sessions, tenant filtering, CSRF and rate limits (4.5)
- [ ] Chat idempotency, reconnect, soft deletion, file upload policy, owner audit and mail debounce (4.6)
- [ ] Per-client durable chat and database API adapters
- [ ] Work client: sessions, messages, pins, receipts, dashboards and state versioning (3.9)

## Contract

## Encrypted messaging implementation

`/work` opens a `message/cpim` window at `im:jason@jasouza.com`. The owner uses the same page and selects a client; the window address becomes `im:{client email}`. This MIME identifies the conversation viewer; the transport is encrypted JSON, not an interoperable CPIM/SIP service.

Sign in with Google to open the workspace. The configured admin can create conversations and view all clients. Clients open an invitation while signed in with its invited email, then choose **Link to my Google account**. Once linked, that Google account is required; the invitation token alone no longer grants access. Google sign-in does not recover encryption keys: restore a saved invitation or enter the shared key on another device. **Invitation link** exposes a link to copy, back up privately and share through a trusted channel. A configured `WORK_OWNER_TOKEN` remains an optional emergency admin login under **Owner access**. No email is sent automatically. The older UUID-account merge design below remains planned.

The browser generates a random 256-bit shared key and encrypts each message with AES-GCM, a fresh 96-bit IV and a 128-bit authentication tag. Additional authenticated data binds protocol version, room, message UUID and authenticated author. The server stores encrypted message envelopes; keys never enter HTTP requests or server storage. Email, author, timestamps and ciphertext lengths remain visible to the service. Shared keys provide no forward secrecy or protection against compromised devices or malicious site JavaScript. Before account linking, anyone holding an invitation can read history and send as that client. The server cannot recover lost keys.

Invitation secrets travel in the URL fragment, which is removed from browser history after import. They are kept in tab session storage; plaintext drafts and pending sends stay in memory only. **Lock workspace** signs out and clears the tab's invitations and owner token: keep an external private backup first. Closing a conversation revokes its client access and prevents further sends; the admin retains read access. Reopening/key rotation is not implemented.

The Worker authenticates each request, derives the author, enforces same-origin mutations and a custom header, accepts bounded ciphertext only, and stores client token hashes in D1. Signed-in clients can list only their linked rooms. Sends have UUID idempotency and a durable 30-message/minute/role/room limit. The browser retains an unacknowledged encrypted envelope for explicit retry, polls every five seconds with backoff to thirty, and catches up by database sequence, 100 messages per page. Messaging works with the personal server offline. WebSockets, attachments, edits/deletes, audit, authentication rate limits and notification email remain future work.

### Google sign-in

`src/node/auth.ts` implements `/api/v1/auth/google/start`, `/api/v1/auth/google/callback`, `/api/v1/auth/session` and `/api/v1/auth/logout`. This is a full-page OIDC authorization-code flow with 256-bit state, a separate browser-binding cookie, PKCE S256 and a nonce. State expires in ten minutes and is atomically consumed once. `jose` verifies Google's RS256 signature, issuer, audience, authorized party, token age, verified email and nonce against Google's pinned JWKS endpoint. Access/ID tokens are not retained or returned to the browser. Opaque session tokens are hashed in D1 and sent only as `__Host-`, HttpOnly, Secure, SameSite=Lax cookies. Sessions expire after thirty idle days; authenticated mutations need the same-origin CSRF token returned by the session API. Sign-out revokes the current session and clears this tab's stored invitations.

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the provisioning machine's private `.env`; staging Terraform binds them to the Worker, with the secret kept out of Pages output. `GOOGLE_ADMIN_EMAIL` defaults to `jason@jasouza.com`. Its first verified login pins its immutable Google subject in `auth_owner`; another Google subject never inherits admin rights just by presenting the same email. Owning the Google Cloud OAuth project gives no application privileges. Changing the admin account later requires an explicit database migration/rebinding by the operator.

The Web application OAuth client must register the exact redirect URI `https://staging.jasouza.com/api/v1/auth/google/callback`. JavaScript origins are unused by this server-side flow. Only `openid email profile` are requested. Client configuration errors are reported as `auth_error=client_configuration`; state expiry, cancelled consent and verification errors have separate safe codes. Never paste authorization codes or tokens into logs or chat. Completing a real Google account sign-in requires the user's account access; local tests cover real RSA/SQL verification and synthetic browser sessions, not a claim to have signed in as the user.

Code: `src/work_crypto.ts`, `src/node/{work,auth}.ts`, `src/web/client/{desk_messages,sign}.ts`, migrations 0002/0003. Tests: `tests/{work,auth}.test.ts`; `npm run test:work:browser` builds and exercises separate owner/client contexts against a dedicated ignored local Worker/D1 state, including Google sessions, account linking, sign-out, a lost acknowledgement and safe retry. The Google-navigation test intercepts the first backend request with redirects disabled, so fake clients never reach Google.

### Staging setup

Set the Google values above, plus an optional `WORK_OWNER_TOKEN` emergency credential, in the private `.env`. Run `npm run tf:staging -- plan` / `apply` from the `staging` checkout. The standalone root creates `jazu-staging-work`, applies SQL migrations and binds D1/credentials to the staging Worker. Production resources are untouched. Publish the static shell through staging CI. Locally, put credentials in `.dev.vars`, register the local backend callback if testing with real Google, then run `npm run db:local`, `npm run serve`, and `npm run cloud:dev`. Never deploy the local Wrangler config.

Verified locally: TypeScript, content validation (37 existing description warnings), staging Terraform validation/mocked tests, and the full Node suite with `--test-concurrency=2` (192 passed, four POSIX-only skips, zero failures). Browser tests against real local Worker/D1 cover desktop/mobile encrypted chat, Google-session admin/client separation, linking, sign-out, reloads, both `im:` addresses, a lost send acknowledgement with deduplicated retry, inert text rendering, mobile width, and the exact OAuth code-flow redirect. Google signature verification uses real RSA signatures in unit tests. Browser authentication sessions are synthetic fixtures; real Google account consent remains a user action.

Suggested next features: encrypted attachments with size limits, read/unread indicators, browser-side history search and secure invitation rotation/device management.

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
