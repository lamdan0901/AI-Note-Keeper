CREATE TABLE IF NOT EXISTS migration_attempts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  blocked_until TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_migration_attempts_key ON migration_attempts (key);