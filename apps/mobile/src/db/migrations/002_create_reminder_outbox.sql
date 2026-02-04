PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reminder_outbox (
  reminderId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  operation TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt INTEGER,
  CHECK (operation IN ('create', 'update', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_updatedAt ON reminder_outbox (updatedAt);
