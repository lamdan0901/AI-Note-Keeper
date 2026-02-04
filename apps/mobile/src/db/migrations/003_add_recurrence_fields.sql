-- Migration 003: Add recurrence fields to reminders table
-- Added: repeat, baseAtLocal, startAt, nextTriggerAt, lastFiredAt, lastAcknowledgedAt, version

ALTER TABLE reminders ADD COLUMN repeat TEXT;
ALTER TABLE reminders ADD COLUMN baseAtLocal TEXT;
ALTER TABLE reminders ADD COLUMN startAt INTEGER;
ALTER TABLE reminders ADD COLUMN nextTriggerAt INTEGER;
ALTER TABLE reminders ADD COLUMN lastFiredAt INTEGER;
ALTER TABLE reminders ADD COLUMN lastAcknowledgedAt INTEGER;
ALTER TABLE reminders ADD COLUMN version INTEGER DEFAULT 0;

-- Create index for query performance on nextTriggerAt
CREATE INDEX IF NOT EXISTS idx_reminders_nextTriggerAt ON reminders (nextTriggerAt);
