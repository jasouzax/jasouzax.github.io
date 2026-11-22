PRAGMA foreign_keys = ON;
CREATE TABLE clients (
    id TEXT PRIMARY KEY, uuid_hash TEXT UNIQUE, slug TEXT UNIQUE, name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '', google_subject TEXT UNIQUE, email TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE device_sessions (
    token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
    label TEXT NOT NULL DEFAULT '', last_seen INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX sessions_client ON device_sessions(client_id);
CREATE TABLE files (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), r2_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL CHECK(size >= 0), hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    UNIQUE(client_id, id)
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), idempotency_id TEXT NOT NULL,
    author TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','file','dashboard','receipt','pin')),
    body TEXT NOT NULL DEFAULT '', ref TEXT, deleted_at INTEGER, created_at INTEGER NOT NULL,
    UNIQUE(client_id, idempotency_id), UNIQUE(client_id, id)
);
CREATE INDEX messages_catchup ON messages(client_id, id);
CREATE TABLE receipts (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), code TEXT NOT NULL,
    provider TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), currency TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('paid','pending')), note TEXT NOT NULL DEFAULT '',
    issued_at INTEGER NOT NULL, paid_at INTEGER, UNIQUE(client_id, code)
);
CREATE TABLE pins (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), message_id TEXT NOT NULL,
    window_json TEXT NOT NULL CHECK(json_valid(window_json)), position INTEGER NOT NULL,
    FOREIGN KEY(client_id, message_id) REFERENCES messages(client_id, id)
);
CREATE TABLE dashboards (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id), name TEXT NOT NULL,
    source_path TEXT NOT NULL, snapshot_json TEXT CHECK(json_valid(snapshot_json)), updated_at INTEGER,
    UNIQUE(client_id, name)
);
CREATE TABLE desk_state (
    client_id TEXT NOT NULL REFERENCES clients(id), actor TEXT NOT NULL,
    state_json TEXT NOT NULL CHECK(json_valid(state_json)), version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    updated_at INTEGER NOT NULL, PRIMARY KEY(client_id, actor)
);
CREATE TABLE admin_audit (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, client_id TEXT REFERENCES clients(id),
    action TEXT NOT NULL, detail_json TEXT CHECK(json_valid(detail_json)), created_at INTEGER NOT NULL
);
