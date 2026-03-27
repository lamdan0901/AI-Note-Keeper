import type { SQLiteDatabase } from 'expo-sqlite/next';

export const migrateLocalUserData = async (
  db: SQLiteDatabase,
  fromUserId: string,
  toUserId: string,
): Promise<boolean> => {
  if (!fromUserId || !toUserId || fromUserId === toUserId) return true;
  try {
    await db.runAsync(`UPDATE notes SET userId = ? WHERE userId = ? OR userId IS NULL`, [
      toUserId,
      fromUserId,
    ]);
    await db.runAsync(`UPDATE note_outbox SET userId = ? WHERE userId = ?`, [toUserId, fromUserId]);
    return true;
  } catch {
    return false;
  }
};

export const clearLocalUserData = async (db: SQLiteDatabase, userId: string): Promise<boolean> => {
  if (!userId) return true;
  try {
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
