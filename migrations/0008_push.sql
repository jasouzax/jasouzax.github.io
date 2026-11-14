-- Browser push transport keys are distinct from conversation decryption keys.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    subscription TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_subscriptions_subject ON push_subscriptions(subject);
CREATE INDEX IF NOT EXISTS push_subscriptions_session ON push_subscriptions(session_hash);
CREATE TABLE IF NOT EXISTS push_receipts (
    subscription_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (subscription_id, message_id)
);
