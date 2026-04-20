CREATE TABLE IF NOT EXISTS device_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user_id ON device_push_tokens (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_push_tokens_device_id ON device_push_tokens (device_id);