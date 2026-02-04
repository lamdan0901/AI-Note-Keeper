import { DbLike } from './noteScheduleLedger';

export type ScheduleLedgerStatus = 'scheduled' | 'canceled' | 'error';

export type ReminderScheduleState = {
  reminderId: string;
  notificationIds: string[];
  lastScheduledHash: string;
  status: ScheduleLedgerStatus;
  lastScheduledAt: number;
  lastError?: string | null;
};

type DbResultRow = {
  reminderId: string;
  notificationIdsJson: string;
  lastScheduledHash: string;
  status: ScheduleLedgerStatus;
  lastScheduledAt: number;
  lastError: string | null;
};

const serializeNotificationIds = (ids: string[]): string => JSON.stringify(ids ?? []);

const parseNotificationIds = (json: string): string[] => {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mapRow = (row: DbResultRow): ReminderScheduleState => ({
  reminderId: row.reminderId,
  notificationIds: parseNotificationIds(row.notificationIdsJson),
  lastScheduledHash: row.lastScheduledHash,
  status: row.status,
  lastScheduledAt: row.lastScheduledAt,
  lastError: row.lastError,
});

export const getScheduleState = async (
  db: DbLike,
  reminderId: string,
): Promise<ReminderScheduleState | null> => {
  const row = await db.getFirstAsync<DbResultRow>(
    `SELECT reminderId, notificationIdsJson, lastScheduledHash, status, lastScheduledAt, lastError
     FROM reminder_schedule_meta
     WHERE reminderId = ?`,
    [reminderId],
  );
  return row ? mapRow(row) : null;
};

export const listScheduleStatesByStatus = async (
  db: DbLike,
  status: ScheduleLedgerStatus,
): Promise<ReminderScheduleState[]> => {
  const rows = await db.getAllAsync<DbResultRow>(
    `SELECT reminderId, notificationIdsJson, lastScheduledHash, status, lastScheduledAt, lastError
     FROM reminder_schedule_meta
     WHERE status = ?`,
    [status],
  );
  return rows.map(mapRow);
};

export const upsertScheduleState = async (
  db: DbLike,
  state: ReminderScheduleState,
): Promise<void> => {
  await db.runAsync(
    `INSERT INTO reminder_schedule_meta (
        reminderId,
        notificationIdsJson,
        lastScheduledHash,
        status,
        lastScheduledAt,
        lastError
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(reminderId) DO UPDATE SET
        notificationIdsJson = excluded.notificationIdsJson,
        lastScheduledHash = excluded.lastScheduledHash,
        status = excluded.status,
        lastScheduledAt = excluded.lastScheduledAt,
        lastError = excluded.lastError`,
    [
      state.reminderId,
      serializeNotificationIds(state.notificationIds),
      state.lastScheduledHash,
      state.status,
      state.lastScheduledAt,
      state.lastError ?? null,
    ],
  );
};

export const deleteScheduleState = async (db: DbLike, reminderId: string): Promise<void> => {
  await db.runAsync('DELETE FROM reminder_schedule_meta WHERE reminderId = ?', [reminderId]);
};
