-- Credentials belong to Google identities; proof and challenges belong to one hashed refresh session.
CREATE TABLE auth_passkeys (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES auth_users(subject) ON DELETE CASCADE,
    public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL,
    name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX auth_passkeys_subject ON auth_passkeys(subject);
CREATE TABLE auth_passkey_challenges (
    session_hash TEXT NOT NULL REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('register', 'verify')), challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL, PRIMARY KEY(session_hash, purpose)
);
CREATE TABLE auth_stepups (
    session_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
    verified_at INTEGER NOT NULL
);
