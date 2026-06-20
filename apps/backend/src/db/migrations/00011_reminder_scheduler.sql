ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS schedule_provider TEXT,
  ADD COLUMN IF NOT EXISTS schedule_target_id TEXT,
  ADD COLUMN IF NOT EXISTS schedule_target_version INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_target_fire_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_notes_reminder_next_fire
  ON notes (next_trigger_at)
  WHERE trigger_at IS NOT NULL
    AND active = true
    AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_reminder_scheduler_missing
  ON notes (next_trigger_at, schedule_target_id)
  WHERE trigger_at IS NOT NULL
    AND active = true
    AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS reminder_deliveries (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_at TIMESTAMP WITH TIME ZONE NOT NULL,
  reminder_version INTEGER NOT NULL,
  delivery_key TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  failure_reason TEXT,
  UNIQUE (reminder_id, occurrence_at),
  UNIQUE (delivery_key),
  CHECK (status IN ('pending', 'sent', 'failed', 'stale', 'canceled'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_deliveries_reminder_created
  ON reminder_deliveries (reminder_id, created_at DESC);
