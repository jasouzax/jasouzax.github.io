-- Presence is reconciled against Durable Object heartbeat leases; NULL means connected.
CREATE TABLE last_signed_in (
    principal TEXT PRIMARY KEY,
    last_online INTEGER
);
CREATE TABLE realtime_limits (
    scope TEXT PRIMARY KEY,
    bucket INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
-- Atomic with message insertion, so temporary delivery failures cannot lose a notification.
CREATE TABLE realtime_outbox (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    created_at INTEGER NOT NULL
);
CREATE INDEX realtime_outbox_source ON realtime_outbox(source, created_at);
