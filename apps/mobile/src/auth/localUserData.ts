import type { SQLiteDatabase } from 'expo-sqlite/next';
import { clearNoteNotificationState } from '../reminders/noteNotificationCleanup';

export const migrateLocalUserData = async (
  db: SQLiteDatabase,
  fromUserId: string,
  toUserId: string,
): Promise<boolean> => {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return true;
  try {
    await db.runAsync(`UPDATE notes SET userId = ? WHERE userId = ?`, [toUserId, fromUserId]);
    await db.runAsync(`UPDATE note_outbox SET userId = ? WHERE userId = ?`, [toUserId, fromUserId]);
    return true;
  } catch {
    return false;
  }
};

export const clearAllLocalData = async (db: SQLiteDatabase): Promise<boolean> => {
  try {
    const noteRows = await db.getAllAsync<{ id: string }>('SELECT id FROM notes');
    for (const row of noteRows) {
      await clearNoteNotificationState(db, row.id);
    }
    await db.runAsync('DELETE FROM note_outbox');
    await db.runAsync('DELETE FROM notes');
    return true;
  } catch {
    return false;
  }
};

export type LocalDataFootprint = {
  hasAnyData: boolean;
  hasLegacyOnlyData: boolean;
  hasNonLegacyData: boolean;
};

export const inspectLocalDataFootprint = async (
  db: SQLiteDatabase,
): Promise<LocalDataFootprint> => {
  const noteRows = await db.getAllAsync<{ count: number }>('SELECT COUNT(*) as count FROM notes');
  const outboxRows = await db.getAllAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM note_outbox',
  );
  const legacyNoteRows = await db.getAllAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM notes WHERE userId IS NULL OR userId = 'local-user'",
  );
  const legacyOutboxRows = await db.getAllAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM note_outbox WHERE userId = 'local-user'",
  );

  const noteCount = noteRows[0]?.count ?? 0;
  const outboxCount = outboxRows[0]?.count ?? 0;
  const legacyNoteCount = legacyNoteRows[0]?.count ?? 0;
  const legacyOutboxCount = legacyOutboxRows[0]?.count ?? 0;

  const totalCount = noteCount + outboxCount;
  const legacyCount = legacyNoteCount + legacyOutboxCount;

  return {
    hasAnyData: totalCount > 0,
    hasLegacyOnlyData: totalCount > 0 && legacyCount === totalCount,
    hasNonLegacyData: totalCount > legacyCount,
  };
};

export const clearLocalUserData = async (db: SQLiteDatabase, userId: string): Promise<boolean> => {
  if (!userId) return true;
  try {
    const noteRows = await db.getAllAsync<{ id: string }>(`SELECT id FROM notes WHERE userId = ?`, [
      userId,
    ]);
    for (const row of noteRows) {
      await clearNoteNotificationState(db, row.id);
    }
    await db.runAsync(`DELETE FROM note_outbox WHERE userId = ?`, [userId]);
    await db.runAsync(`DELETE FROM notes WHERE userId = ?`, [userId]);
    return true;
  } catch {
    return false;
  }
};

export const backfillMissingLocalUserId = async (
  db: SQLiteDatabase,
  userId: string,
): Promise<void> => {
  if (!userId) return;
  await db.runAsync(`UPDATE notes SET userId = ? WHERE userId IS NULL`, [userId]);
};
