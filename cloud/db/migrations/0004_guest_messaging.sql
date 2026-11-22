-- Preserve old encrypted history while retiring invitation/bearer authentication.
CREATE TABLE work_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cookie_hash TEXT NOT NULL UNIQUE,
    ip_day TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX work_guests_rate ON work_guests(ip_day, created_at);
ALTER TABLE work_rooms ADD COLUMN guest_id INTEGER REFERENCES work_guests(id);
ALTER TABLE work_rooms ADD COLUMN owner_wrap TEXT CHECK(owner_wrap IS NULL OR json_valid(owner_wrap));
ALTER TABLE work_rooms ADD COLUMN owner_key_id TEXT;
CREATE UNIQUE INDEX work_rooms_guest ON work_rooms(guest_id) WHERE guest_id IS NOT NULL;
CREATE UNIQUE INDEX work_rooms_account ON work_rooms(google_subject) WHERE google_subject IS NOT NULL AND revoked = 0 AND owner_wrap IS NOT NULL;
CREATE TABLE work_owner_keys (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    subject TEXT NOT NULL,
    key_id TEXT NOT NULL,
    public_jwk TEXT NOT NULL CHECK(json_valid(public_jwk)),
    created_at INTEGER NOT NULL
);
-- OAuth credentials are encrypted with a key derived from the opaque session cookie.
CREATE TABLE auth_google_grants (
    session_hash TEXT PRIMARY KEY REFERENCES auth_sessions(token_hash) ON DELETE CASCADE,
    sealed TEXT NOT NULL
);
CREATE TABLE work_key_files (
    subject TEXT PRIMARY KEY REFERENCES auth_users(subject),
    file_id TEXT NOT NULL UNIQUE
);
