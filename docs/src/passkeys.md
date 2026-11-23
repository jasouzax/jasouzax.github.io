# Passkey authentication

`cloud/api/auth/passkey.ts` owns credential registration, verification and recent-auth policy. `cloud/db/migrations/0009_passkeys.sql` owns credentials, single-use challenges and refresh-session proof. `desk/work/passkeys.ts` provides the account settings dialog and verification flow. `auth.ts` computes owner authority from D1 and checks recent proof before deletion; JWT discovery remains an optimization, not authorization for sensitive operations.

The implementation uses pinned `@simplewebauthn/server` 14.1.0 and `@simplewebauthn/browser` 14.0.0. Both use local bundles. No remote scripts or attestation metadata calls are required by the configured `none` attestation flow. Supported credential algorithms are ES256 and RS256 with required user verification.

| Method and path under `/api/_/auth/passkeys` | Behavior |
| --- | --- |
| `GET /` (without trailing slash) | Public metadata for the signed-in user's own keys, recent-proof status and owner-lock status |
| `POST /register/options` | Requires recent Google sign-in for the first key, or recent passkey proof for an account with keys |
| `POST /register` | Consumes the session's registration challenge and verifies the returned credential before atomic enrollment/proof |
| `POST /verify/options` | Generates a five-minute challenge allowing only this account's keys |
| `POST /verify` | Consumes the challenge, verifies signature, origin, RP and UV, then updates the counter and proof |
| `POST /remove` | Removes only the named key belonging to this account after recent passkey proof |

All POST routes require the existing same-origin/CSRF headers. Credential payloads are bounded to 32 KiB, enrollment to ten keys per account and names to 80 characters. Challenges are bound to the refresh hash, operation and five-minute expiry; failed verification consumes a valid challenge. Counters use compare-and-swap updates. Authenticators whose signature counters stay zero remain supported.

An account with keys can sign in with Google but a new owner session reports `role: client, step_up: true` until a passkey is verified. The account menu lets the owner verify and reload to unlock the owner interface. Verification expires for deletion after five minutes; owner login proof lasts for that refresh session. `/api/_/session?fresh=1` rechecks D1 and refreshes the access JWT after verification or settings changes. Realtime uses `read_session_hash` to apply the same authority policy on every command; the personal-server owner gate also checks pending passkey proof, including explicitly allowed owner emails.

Accounts without keys can delete only within five minutes of a fresh Google session. Stale deletion opens the Passkeys dialog with a Google sign-in link; it does not perform deletion automatically after returning. Enrolled accounts always need recent passkey proof, even if their Google session is new. CSRF and explicit deletion confirmation remain mandatory.

Deployment preparation now uses the same browser dependency-resolution target as staging and local edge builds, so the WebAuthn library's ASN.1 packages resolve into the standalone Worker bundle. Verify with `node --import tsx --test tests/cloud/api/passkey.test.ts tests/cloud/api/auth/runtime.test.ts` and `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome npx playwright test --config tests/work_browser.config.ts passkey_browser.spec.ts` (set the environment variable using your shell's syntax).
