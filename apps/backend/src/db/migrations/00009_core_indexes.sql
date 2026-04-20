CREATE INDEX IF NOT EXISTS idx_notes_active_next_trigger_at
  ON notes (next_trigger_at)
  WHERE active = true AND deleted_at IS NULL AND next_trigger_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_active_snoozed_until
  ON notes (snoozed_until)
  WHERE active = true AND deleted_at IS NULL AND snoozed_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_active_trigger_at
  ON notes (trigger_at)
  WHERE active = true AND deleted_at IS NULL AND trigger_at IS NOT NULL;
