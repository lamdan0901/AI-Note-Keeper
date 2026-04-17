CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT,
  content_type TEXT,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  done BOOLEAN,
  is_pinned BOOLEAN,
  trigger_at TIMESTAMP WITH TIME ZONE,
  repeat_rule TEXT,
  repeat_config JSONB,
  repeat JSONB,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  schedule_status TEXT,
  timezone TEXT,
  base_at_local TEXT,
  start_at TIMESTAMP WITH TIME ZONE,
  next_trigger_at TIMESTAMP WITH TIME ZONE,
  last_fired_at TIMESTAMP WITH TIME ZONE,
  last_acknowledged_at TIMESTAMP WITH TIME ZONE,
  version INTEGER DEFAULT 1,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);