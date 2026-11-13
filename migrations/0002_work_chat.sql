-- Separate encrypted chat tables keep the future work/files/receipts contract intact.
CREATE TABLE IF NOT EXISTS work_rooms (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);
CREATE TABLE IF NOT EXISTS work_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES work_rooms(id),
    id TEXT NOT NULL,
    author TEXT NOT NULL CHECK (author IN ('owner', 'client')),
    envelope TEXT NOT NULL CHECK (json_valid(envelope)),
    created_at INTEGER NOT NULL,
    UNIQUE (room_id, id)
);
CREATE INDEX IF NOT EXISTS work_messages_catchup ON work_messages(room_id, seq);
CREATE INDEX IF NOT EXISTS work_messages_rate ON work_messages(room_id, author, created_at);
