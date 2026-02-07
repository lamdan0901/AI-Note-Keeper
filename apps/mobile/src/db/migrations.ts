type Migration = {
  id: string;
  sql: string;
};

export const migrations: Migration[] = [
  {
    id: '001_create_reminders_and_ledger',
    sql: `
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
`.trim(),
  },
  {
    id: '002_create_reminder_outbox',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reminder_outbox (
  reminderId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  operation TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt INTEGER,
  CHECK (operation IN ('create', 'update', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_updatedAt ON reminder_outbox (updatedAt);
`.trim(),
  },
  {
    id: '003_create_notes',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  CHECK (active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_notes_updatedAt ON notes (updatedAt);
CREATE INDEX IF NOT EXISTS idx_notes_active ON notes (active);
`.trim(),
  },
  {
    id: '004_create_note_outbox',
    sql: `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS note_outbox (
  noteId TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  operation TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  payloadHash TEXT NOT NULL,
  updatedAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt INTEGER,
  CHECK (operation IN ('create', 'update', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_note_outbox_updatedAt ON note_outbox (updatedAt);
`.trim(),
  },
  {
    id: '005_merge_reminders_into_notes',
    sql: `
ALTER TABLE notes ADD COLUMN triggerAt INTEGER;
ALTER TABLE notes ADD COLUMN repeatRule TEXT;
ALTER TABLE notes ADD COLUMN repeatConfig TEXT;
ALTER TABLE notes ADD COLUMN snoozedUntil INTEGER;
ALTER TABLE notes ADD COLUMN scheduleStatus TEXT;
ALTER TABLE notes ADD COLUMN timezone TEXT;
    `.trim(),
  },
  {
    id: '006_create_note_schedule_meta',
    sql: `
-- Schedule ledger for note reminder notifications (no FK constraint since notes are the source)
CREATE TABLE IF NOT EXISTS note_schedule_meta (
  noteId TEXT PRIMARY KEY,
  notificationIdsJson TEXT NOT NULL,
  lastScheduledHash TEXT NOT NULL,
  status TEXT NOT NULL,
  lastScheduledAt INTEGER NOT NULL,
  lastError TEXT,
  CHECK (status IN ('scheduled', 'canceled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_note_schedule_meta_status ON note_schedule_meta (status);
    `.trim(),
  },
  {
    id: '007_add_recurrence_to_notes',
    sql: `
ALTER TABLE notes ADD COLUMN repeat TEXT;
ALTER TABLE notes ADD COLUMN baseAtLocal TEXT;
ALTER TABLE notes ADD COLUMN startAt INTEGER;
ALTER TABLE notes ADD COLUMN nextTriggerAt INTEGER;
ALTER TABLE notes ADD COLUMN lastFiredAt INTEGER;
ALTER TABLE notes ADD COLUMN lastAcknowledgedAt INTEGER;
ALTER TABLE notes ADD COLUMN version INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notes_nextTriggerAt ON notes (nextTriggerAt);
    `.trim(),
  },
  {
    id: '008_add_done_to_notes',
    sql: `
ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
    `.trim(),
  },
  {
    id: '009_create_notification_ledger',
    sql: `
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

CREATE INDEX IF NOT EXISTS idx_notification_ledger_reminder_event ON notification_ledger (reminderId, eventId);
CREATE INDEX IF NOT EXISTS idx_notification_ledger_created ON notification_ledger (createdAt);
CREATE INDEX IF NOT EXISTS idx_notification_ledger_source ON notification_ledger (source);
    `.trim(),
  },
  {
    id: '010_add_sync_status',
    sql: `
-- Add sync status tracking to notes
ALTER TABLE notes ADD COLUMN syncStatus TEXT DEFAULT 'synced';
ALTER TABLE notes ADD COLUMN serverVersion INTEGER DEFAULT 0;

-- Add retry tracking to note outbox
ALTER TABLE note_outbox ADD COLUMN retryCount INTEGER DEFAULT 0;
ALTER TABLE note_outbox ADD COLUMN nextRetryAt INTEGER;

-- Index for querying pending notes
CREATE INDEX IF NOT EXISTS idx_notes_syncStatus ON notes (syncStatus);

-- Index for retry processing
CREATE INDEX IF NOT EXISTS idx_note_outbox_nextRetryAt ON note_outbox (nextRetryAt);
    `.trim(),
  },
];
