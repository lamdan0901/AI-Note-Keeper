-- Migration 009: Create notification ledger table
-- Purpose: Track all notification deliveries (local and FCM) to prevent duplicates

CREATE TABLE IF NOT EXISTS notification_ledger (
  id TEXT PRIMARY KEY,
  reminderId TEXT NOT NULL,
  eventId TEXT NOT NULL,
  source TEXT NOT NULL,
  sentAt INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  CHECK (source IN ('local', 'fcm')),
  CHECK (dismissed IN (0, 1))
);

-- Index for quick lookups by reminderId and eventId (deduplication checks)
CREATE INDEX IF NOT EXISTS idx_notification_ledger_reminder_event ON notification_ledger (reminderId, eventId);

-- Index for cleanup queries (find old records)
CREATE INDEX IF NOT EXISTS idx_notification_ledger_created ON notification_ledger (createdAt);

-- Index for source-based queries
CREATE INDEX IF NOT EXISTS idx_notification_ledger_source ON notification_ledger (source);
