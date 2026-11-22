CREATE TABLE auth_users (
    subject TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE auth_owner (
    id INTEGER PRIMARY KEY CHECK(id = 1), subject TEXT NOT NULL UNIQUE REFERENCES auth_users(subject)
);
CREATE TABLE auth_flows (
    state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL,
    verifier TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX auth_flows_expiry ON auth_flows(expires_at);
CREATE TABLE auth_sessions (
    token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES auth_users(subject),
    created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(last_seen);
ALTER TABLE work_rooms ADD COLUMN google_subject TEXT REFERENCES auth_users(subject);
CREATE INDEX work_rooms_google ON work_rooms(google_subject);
