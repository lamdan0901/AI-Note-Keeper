CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  billing_cycle_custom_days INTEGER,
  next_billing_date TIMESTAMP WITH TIME ZONE NOT NULL,
  notes TEXT,
  trial_end_date TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL,
  reminder_days_before JSONB NOT NULL DEFAULT '[]',
  next_reminder_at TIMESTAMP WITH TIME ZONE,
  last_notified_billing_date TIMESTAMP WITH TIME ZONE,
  next_trial_reminder_at TIMESTAMP WITH TIME ZONE,
  last_notified_trial_end_date TIMESTAMP WITH TIME ZONE,
  active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active_status_next_reminder
  ON subscriptions (user_id, active, status, next_reminder_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active_status_next_trial_reminder
  ON subscriptions (user_id, active, status, next_trial_reminder_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active_deleted_at
  ON subscriptions (user_id, active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_active_status_next_billing_date
  ON subscriptions (user_id, active, status, next_billing_date);