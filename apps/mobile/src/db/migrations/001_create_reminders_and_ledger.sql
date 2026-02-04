PRAGMA foreign_keys = ON;

-- Reminders table (local source of truth)
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  noteId TEXT,
  title TEXT,
  triggerAt INTEGER NOT NULL,
  repeatRule TEXT NOT NULL DEFAULT 'none',
  repeatConfig TEXT,
  snoozedUntil INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  scheduleStatus TEXT NOT NULL DEFAULT 'unscheduled',
  timezone TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  CHECK (repeatRule IN ('none', 'daily', 'weekly', 'custom')),
  CHECK (scheduleStatus IN ('scheduled', 'unscheduled', 'error')),
  CHECK (active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_reminders_updatedAt ON reminders (updatedAt);
CREATE INDEX IF NOT EXISTS idx_reminders_triggerAt ON reminders (triggerAt);
CREATE INDEX IF NOT EXISTS idx_reminders_active ON reminders (active);

-- Schedule ledger for local notification state
CREATE TABLE IF NOT EXISTS reminder_schedule_meta (
  reminderId TEXT PRIMARY KEY,
  notificationIdsJson TEXT NOT NULL,
  lastScheduledHash TEXT NOT NULL,
  status TEXT NOT NULL,
  lastScheduledAt INTEGER NOT NULL,
  lastError TEXT,
  CHECK (status IN ('scheduled', 'canceled', 'error')),
  FOREIGN KEY (reminderId) REFERENCES reminders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_meta_status ON reminder_schedule_meta (status);
