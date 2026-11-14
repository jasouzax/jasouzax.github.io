-- Recoverable client-only fallback; the sealing secret is a separate Worker binding.
CREATE TABLE unstored_keys (
    subject TEXT PRIMARY KEY REFERENCES auth_users(subject) ON DELETE CASCADE,
    email TEXT NOT NULL,
    room_id TEXT NOT NULL UNIQUE,
    sealed TEXT NOT NULL CHECK(json_valid(sealed)),
    created_at INTEGER NOT NULL
);
-- A non-secret completion marker prevents stale tabs from recreating deleted backups.
CREATE TABLE work_key_promotions (
    subject TEXT PRIMARY KEY REFERENCES auth_users(subject) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    key_hash TEXT NOT NULL
);
