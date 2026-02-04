-- Migration 007: Add recurrence fields to notes table
-- Added: repeat, baseAtLocal, startAt, nextTriggerAt, lastFiredAt, lastAcknowledgedAt, version

ALTER TABLE notes ADD COLUMN repeat TEXT;
ALTER TABLE notes ADD COLUMN baseAtLocal TEXT;
ALTER TABLE notes ADD COLUMN startAt INTEGER;
ALTER TABLE notes ADD COLUMN nextTriggerAt INTEGER;
ALTER TABLE notes ADD COLUMN lastFiredAt INTEGER;
ALTER TABLE notes ADD COLUMN lastAcknowledgedAt INTEGER;
ALTER TABLE notes ADD COLUMN version INTEGER DEFAULT 0;

-- Create index for query performance on nextTriggerAt
CREATE INDEX IF NOT EXISTS idx_notes_nextTriggerAt ON notes (nextTriggerAt);
