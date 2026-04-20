CREATE TABLE IF NOT EXISTS note_change_events (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  device_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_change_events_note_id ON note_change_events (note_id);
CREATE INDEX IF NOT EXISTS idx_note_change_events_payload_hash ON note_change_events (payload_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_change_events_dedupe
  ON note_change_events (note_id, user_id, operation, payload_hash);