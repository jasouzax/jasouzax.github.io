# Optional account passkeys

- [?] Registration, listing and removal with session/CSRF checks and recent authentication.
- [?] User-verified assertions, single-use session-bound challenges, origin/RP checking and signature-counter updates.
- [?] Owner sessions require a passkey after Google sign-in when the account has registered keys.
- [?] Account deletion requires proof within five minutes. Accounts without passkeys require a Google sign-in within five minutes.
- [?] Header account menu exposes Passkeys settings, explicit verification, removal confirmation and Google sign-in recovery for accounts without keys.

Passkeys supplement Google identity. They do not replace Google sign-in or CSRF. Registering the first key opts the account into passkey protection; removing the last key disables it. Register a backup before relying on this protection. A Google sign-in alone cannot bypass an enrolled key. Losing every registered authenticator requires an operator to verify ownership and deliberately recover the account; the application has no automatic bypass.

Apply D1 migration `0009_passkeys.sql` before deploying the updated Worker. Deploy the matching browser assets too. This continuation did not migrate or deploy production. Production and staging use their own databases and origin-bound credentials. Real hardware enrollment and human acceptance remain to be checked.

The browser keeps no passkey material in local/session storage. D1 stores public keys and counters, plus proof/challenges keyed by the hashed refresh session. Expiring a refresh session removes its challenge and proof through foreign keys. Account deletion removes keys and all sessions atomically, preserving the existing encrypted-message retention rules.

Verification: real SQLite policy tests and local workerd/D1 tests pass. Chromium's virtual CTAP2 authenticator registered and signed actual credentials through the settings UI; tests cover new owner sessions, successful proof, replay, expired proof, failed verification and deletion. Synthetic accounts only were used. See [implementation and endpoints](../src/passkeys.md).
