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
- [x] Direct encrypted guest/client chat, browser/Drive keys, owner Clients/Guests panel, idempotent sends, catch-up polling and `message/cpim` / `im:` windows
- [x] Client-only encrypted `unstored_keys` fallback, cross-device Google recovery and verified Drive handoff with backup deletion (no key rotation)
- [x] Google OIDC code flow, verified identities, pinned admin subject, hashed HttpOnly sessions, CSRF, sign-out and guest-to-Google linking
- [x] Signed-in sign-out/account deletion controls, confirmation, all-device revocation and atomic profile deletion with closed/anonymized client links
- [ ] Extend guest/Google authorization to remaining workspace APIs and add owner audit (4.5)
- [ ] Chat idempotency, reconnect, soft deletion, file upload policy, owner audit and mail debounce (4.6)
- [ ] Per-client durable chat and database API adapters
- [ ] Work client: sessions, messages, pins, receipts, dashboards and state versioning (3.9)

## Contract

### Realtime prototypes

The staging realtime transport uses hibernating Durable Objects keyed by authenticated account or existing guest cookie. Account sockets may connect across the site; guest sockets are limited to one per session and the Work page. Same-origin upgrades, connection/command limits, hashed credentials, session revocation and a 30-second automatic ping / roughly 90-second expiry protect the transport. Presence aggregates all live account sockets and uses migration 0007's `last_signed_in`; its nullable timestamp is a projection reconciled against the Durable Object's heartbeat state. Unknown identities have no fabricated last-online time. Channel and conversation IDs keep the transport independent from Work-specific authorization. Initial history and reconnect catch-up remain durable D1 reads.

Prototype 1 introduces the server transport/presence and local/runtime infrastructure. Chat delivery, subscriptions and site-wide notification integration follow in separate staging commits.

Prototype 2 adds the Work adapter, authorized conversation/presence subscriptions, ciphertext sends over the socket, cursor-ordered delivery and a D1 outbox inserted atomically with messages. Delivery failures leave outbox rows for the source object's alarm to retry. D1 commit precedes acknowledgements and receiver events; retries use the existing immutable message UUID. The same publication path bridges HTTP sends from older clients. A recipient outside the chat receives a generic encrypted-message notification event without decrypting content server-side.

Prototype 3 connects signed-in accounts across all pages and guest views only on Work, replaces recurring chat/Clients HTTP polling with live events, renders peer presence with a client-side relative-time clock, and adds theme-aware in-page notices plus opt-in desktop notifications while the website is open. Chat opens clear their earlier notice. Guest tabs replace the previous socket and recover the same browser key/history when focus returns. Linking a guest publishes a separate conversation-update event for the owner panel. Initial and reconnect catch-up still use HTTP; this is not periodic polling. Browser closure requires future Web Push support, and Online does not guarantee the person has read or noticed a message.

Prototype 4 isolates channel authorization/history/send/notification adapters in `node/realtime_channels.ts`, reconciles heartbeat deadlines using the last automatic ping response, restores state across hibernation and preserves an offline timestamp without drifting it forward. Session revocation closes sockets; account deletion removes its D1 presence and queued delivery metadata. Cross-tab account changes refresh identity, and stale auth requests cannot restore a superseded identity. Tests cover delivery outages, reconnect cursors, guest replacement, site-wide notices and local relative-time updates.

## Encrypted messaging implementation

`/work` opens directly to a text composer and Send button in a `message/cpim` window at `im:jason@jasouza.com`, including for signed-out visitors. There are no invitations, owner access tokens or credentials to copy. The MIME identifies the viewer; transport uses encrypted JSON rather than interoperable CPIM/SIP.

A visitor gets an automatic HttpOnly, Secure, SameSite=Lax guest cookie. Only its hash is stored in D1. The browser generates a random 256-bit conversation key, saves it in persistent local storage before sending, and encrypts messages with AES-GCM and fresh 96-bit IVs. Authenticated data binds the room, message UUID and server-authenticated author. Clearing browser storage can lose guest history access; the service does not receive guest or normal Drive-only message keys.

The owner signs in once with the configured admin Google account to initialize encryption. The browser creates a P-256 ECDH key pair, saves the private key in that account's hidden Google Drive application data folder, and publishes only the public key. Each client wraps its conversation key to that public key with an ephemeral P-256 key and AES-GCM, bound to the room ID. D1 stores the wrapped key and ciphertext. The owner restores their private key from Drive and unwraps keys locally. An existing public key cannot be silently replaced when its private key is missing. Guests can compose before this initial setup, but sending waits for the owner's public key.

### Google Drive keys and guest sign-in

Enable Google Drive API in the OAuth client's Cloud project and configure the `https://www.googleapis.com/auth/drive.appdata` scope in Google Auth Platform → Data Access. Keep test accounts in the OAuth Testing audience. No additional client secret or manual token is required. Sign-in requests `openid email profile` plus this app-data scope; existing sessions must sign in again to grant it. The app never requests general access to Drive files. See [Google's app-data documentation](https://developers.google.com/workspace/drive/api/guides/appdata).

Normal Drive-only keys travel directly between the browser and Google Drive. The client fallback described below deliberately passes its key through the Worker over HTTPS. Each account gets one immutable `jazu-work-keys-v2-{host}.json` in `appDataFolder`, keeping staging and production separate even with a shared OAuth client. The server reserves a Google-generated file ID per verified subject, preventing simultaneous devices from creating conflicting key files. Upload retries read the existing file after a conflict instead of overwriting it. Owner files hold the private key pair; client files hold the conversation key and its room/wrapping information. Another device signed in to the same account restores this file automatically.

If a guest signs in and the Google account has no prior key, the app saves the guest key to Drive before atomically binding the conversation to that subject. Anonymous access to a bound room then stops. If the Google account already has a different conversation key, the app warns that guest messages were not transferred, opens the existing account conversation, and preserves the separate guest key/history. Signing out returns to that browser's unbound guest conversation. It never merges or overwrites existing keys/history. Missing or invalid existing keys and key conflicts leave the composer visible and report the problem without delivering an unreadable message. New clients can use the recoverable fallback below when Drive is unavailable.

Google OAuth access/refresh credentials are encrypted in D1 with a key derived from the opaque HttpOnly session cookie; they cannot be decrypted from the database alone. A CSRF-protected endpoint supplies short-lived Drive access to the browser in memory only. Refresh happens server-side when needed. Provider tokens never enter browser persistent storage, URLs or profile JSON. Logout/deletion remove the session's encrypted credentials. Google ID tokens are verified and discarded. Trust in the application/its delivered JavaScript and Google account security is still required; this scheme does not provide forward secrecy.

### Client fallback when Drive is unavailable

Signed-in **clients only** can store their conversation key in `unstored_keys` (migration 0006) if Drive consent/storage is unavailable. Guests keep browser-only keys; the owner still requires Drive. The row is indexed by the verified Google subject and room ID, with email metadata, creation time and an AES-256-GCM sealed client-key bundle. A fresh IV and authenticated data bind the origin, subject and room. `WORK_FALLBACK_KEY` is a persistent random 32-byte base64url **Worker secret**, separate from D1. The Pi is not involved. Preserve the secret securely: changing or losing it makes existing fallback keys unreadable. Private Terraform state/plans and the local `.env` also contain the secret and must be protected separately from database exports.

The server uses the authenticated subject, checks same-origin/CSRF, rejects guests/owners, and never accepts an email as authorization. Backup writes are immutable: concurrent devices restore the winning key instead of replacing it. Existing Drive conversations whose keys are unavailable are preserved and require Drive reconnection; a new key cannot recover old ciphertext. An existing unresolved Drive-file reservation is also preserved rather than guessing a replacement key.

Fallback mode shows **Provide Drive access for E2E encryption** and a notice explaining server recovery. Its button opens the existing Google consent flow (`?drive=1`). After access is granted, the browser uploads the original key to its immutable private Drive file and reads it back. The Worker independently reads that account's reserved Drive file using its scoped Google credentials and compares the complete key bundle before atomically recording a non-secret completion marker and **deleting the entire `unstored_keys` row**. Failed uploads, missing access, mismatched files or verification failures retain the backup and keep messaging available. The completion marker prevents stale tabs from recreating the deleted backup. Account deletion removes both tables' records. This does not rotate the conversation key.

The fallback is server-recoverable encryption, **not E2E encryption**: a D1-only export cannot decrypt keys without the separate Worker secret, but compromise of the Worker/secret plus database can. Deletion removes the live backup; older database backups can retain the sealed key. Moving the same key into Drive does not retroactively remove that exposure. Key rotation and backup-retention improvements remain future work.

### Owner Clients panel

The conversation layout uses a compact service-connection bar and Google sign-in state, centered encryption notice, timestamps above theme-colored incoming/outgoing bubbles, and a bottom composer with an account avatar and accessible Send icon. Only the message history displays a scrollbar; the chat window disables inherited file-viewer scrolling and the growing textarea hides its scrollbar while keeping caret navigation available for long drafts. The avatar opens account actions. The connection indicator describes the messaging service, not the owner's presence. Shared geometry lives in `content/theme/work.scss`; theme paint uses inherited tokens with a Memory variant.

Client and guest entries use the same `article.desk_side_item` / `details.desk_side_item_box` / summary/name/icon/subtree structure as Files, without list elements in the Clients page. Google photo URLs are accepted only from verified identity claims or matching-subject Google userinfo responses, stored in migration 0005's `auth_profiles`, and removed with the website account. Existing sessions backfill their own photo without requiring a new scope or sign-in. Images use a narrow Google-host allowlist, no referrer, and a guest fallback when absent or unavailable.

Only the pinned admin sees the additional **Clients** side-panel page. **Guests** is the first expandable group, with anonymous conversations addressed as `im:guest/{number}`. Registered clients appear by verified Google email and open `im:{email}` windows. Clicking a client opens/focuses a conversation window, leaving other conversations available. The list refreshes and paginates through all conversations with messages; opening the website without sending does not create a visible client entry. All list/read/send permissions are checked server-side, independently of panel visibility. Guest cookies cannot list or access another guest's room, and owner bearer authentication is retired.

### Delivery, sessions and deletion

Sends use UUID idempotency, immutable encrypted retry envelopes and a durable 30-message/minute/author/room limit. Polling catches up by sequence in pages of 100, with reconnect backoff. Guest provisioning is limited to 20 new identities per daily hashed IP; no raw IP is stored by this code. Same-origin mutations require the workspace header and guest/session CSRF. Google sessions last thirty idle days; guest cookies last at most a year. Signed-in menu controls offer Sign out of Google and Delete Account.

Account deletion requires native confirmation and a CSRF/intent-protected transaction. It removes the website profile, all device sessions, encrypted OAuth credentials and Drive file mapping, and closes/anonymizes linked client rooms. It retains the other participant's encrypted history and unrelated clients. The Google account and its private Drive key file are not deleted; app data can be removed through Google separately. Deleting the owner profile does not delete client history or replace the pinned public encryption key.

### Code, tests and staging setup

Code: `src/work_crypto.ts`, `src/node/{work,auth,google_grant}.ts`, `src/web/client/{desk_messages,work_session,work_drive,sign}.ts`, migrations 0002–0006. Old encrypted records are retained by the additive migration; invitation authentication is no longer accepted. Configure the existing Google client values and `GOOGLE_ADMIN_EMAIL` (default `jason@jasouza.com`) in private `.env`. `WORK_OWNER_EMAIL` controls the displayed owner address. Apply the standalone staging Terraform root using its existing state, then publish the static shell through staging CI. No owner token is configured or required. Never deploy the local Wrangler config.

Tests use real SQLite, AES-GCM/ECDH, RSA verification and workerd. Browser tests exercise a local Worker/D1, real browser crypto, synthetic Google sessions and mocked Drive storage: guest/owner chat, browser reload, Drive recovery on a new device, first-time account linking, existing-key warning, no cross-guest access, account menu/deletion, and safe retries. Real Google consent/Drive access requires the user's configured Cloud project and account interaction; mocked tests do not claim to have performed that consent.

Suggested next features: encrypted attachments, unread indicators, history search, abuse moderation and explicit key/device recovery.

Local verification: TypeScript, content validation (37 existing description warnings), staging Terraform mocked tests, 198 passing Node tests with four platform skips, and all seven Work/Google browser flows passed. The browser's Google sessions and Drive service are synthetic; real Drive consent and the owner's initial public-key publication remain account actions.

*This is the target contract; a described capability is not a claim that it has shipped. The status list above is authoritative.*

## 1.8 Work page

**Objective.** Give every client one URL for messages, shared files, dashboards, quotations and receipts, while the owner never compiles or stores any client data into the website.

**Solution.** One path, `/work`, with no invitation links or credential-bearing entry URLs. It is a static shell with `<desk server="true">`; everything about a client is client-side at runtime from the API (4.3), so nothing is compiled. On first use the client gets an empty work repository, which they see as `/home/user/{id}`; they may move it anywhere in their filesystem, because the virtual filesystem only remaps it and the real repository never changes directory. Menu tabs: **Files** (the repository), **Dashboard** (live project status), **Quotation** (receipts table). The main window is the message stream; files, dashboard segments and quotations can be embedded in messages and pinned as new `view` windows. The owner signs in and the same page shows a menu of all clients (no separate admin path); the owner's own desk state per client is restored.

Sessions use automatic guest cookies or verified Google sign-in. Guests can message immediately after the owner's one-time encryption setup. Browser-held guest keys are saved to the signed-in account's Drive app-data folder before binding. An existing account key opens the existing conversation and warns that guest messages were not transferred; histories are never merged automatically. The owner uses the Clients/Guests panel and never enters an access token. Runtime details are in 3.9 and 4.5.

## 3.9 Work client

**Objective.** The client-side half of `/work` (1.8).

**Solution.** Uses automatic guest or Google sessions, creates the empty work repository as `/home/user/{id}` (remappable anywhere in the virtual filesystem), opens the message composer without sign-in, runs the message window (WebSocket with a polling fallback of 5 s backing off to 30 s, idempotent sends, catch-up after reconnect), embeds and pins components as windows, renders the Quotation and Dashboard tabs from the API, and saves the client's or admin's desk state with optimistic concurrency.

## 4.5 Authentication and authorization

**Objective.** Identify clients and the owner without passwords and without tenants seeing each other.

**Solution.** The Worker's OIDC code/PKCE/nonce flow verifies Google signatures, issuer, audience, expiry and verified email, then creates an opaque HttpOnly session. The configured admin email bootstraps a pinned Google subject. Guests use automatically provisioned browser cookies; all mutations require same-origin workspace headers and CSRF. Google app-data permission backs up conversation keys without an invitation or owner secret. Extend the same per-participant filtering to future files/receipts/dashboard APIs. Owner audit remains planned.

## 4.6 Chat

**Objective.** Real-time messaging that keeps working when the personal server is down.

**Solution.** The database is the source of truth; the durable object only fans out and tracks presence. A client socket sends a message with a client-generated id (idempotency), the room inserts it, acknowledges, and broadcasts to every socket of that client including the owner's. Reconnecting fetches `after={last_id}`. Edits and deletes are soft. The owner is notified by email through a debounced send (at most one per client per ten minutes).
