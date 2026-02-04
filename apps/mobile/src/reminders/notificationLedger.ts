import { SQLiteDatabase } from 'expo-sqlite/next';
import uuid from 'react-native-uuid';

export type NotificationSource = 'local' | 'fcm';

export type NotificationLedgerEntry = {
  id: string;
  reminderId: string;
  eventId: string;
  source: NotificationSource;
  sentAt: number;
  dismissed: boolean;
  createdAt: number;
};

export type DbLike = SQLiteDatabase;

/**
 * Record a notification delivery in the ledger
 */
export const recordNotificationSent = async (
  db: DbLike,
  reminderId: string,
  eventId: string,
  source: NotificationSource,
  sentAt: number = Date.now(),
): Promise<void> => {
  const id = uuid.v4() as string;
  const createdAt = Date.now();

  await db.runAsync(
    `INSERT INTO notification_ledger (id, reminderId, eventId, source, sentAt, dismissed, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, reminderId, eventId, source, sentAt, 0, createdAt],
  );
};

/**
 * Get recent notifications for a reminder within a time window
 */
export const getRecentNotifications = async (
  db: DbLike,
  reminderId: string,
  withinMs: number,
): Promise<NotificationLedgerEntry[]> => {
  const cutoffTime = Date.now() - withinMs;

  const rows = await db.getAllAsync<{
    id: string;
    reminderId: string;
    eventId: string;
    source: string;
    sentAt: number;
    dismissed: number;
    createdAt: number;
  }>(
    `SELECT * FROM notification_ledger 
     WHERE reminderId = ? AND sentAt >= ?
     ORDER BY sentAt DESC`,
    [reminderId, cutoffTime],
  );

  return rows.map((row) => ({
    id: row.id,
    reminderId: row.reminderId,
    eventId: row.eventId,
    source: row.source as NotificationSource,
    sentAt: row.sentAt,
    dismissed: row.dismissed === 1,
    createdAt: row.createdAt,
  }));
};

/**
 * Check if a local notification was already sent for a specific event
 * Used for duplicate prevention when FCM notification arrives
 */
export const hasLocalNotificationSent = async (
  db: DbLike,
  reminderId: string,
  eventId: string,
): Promise<boolean> => {
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM notification_ledger 
     WHERE reminderId = ? AND eventId = ? AND source = 'local'`,
    [reminderId, eventId],
  );

  return (result?.count ?? 0) > 0;
};

/**
 * Check if any notification (local or FCM) was already sent for a specific event
 */
export const hasNotificationSent = async (
  db: DbLike,
  reminderId: string,
  eventId: string,
): Promise<boolean> => {
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM notification_ledger 
     WHERE reminderId = ? AND eventId = ?`,
    [reminderId, eventId],
  );

  return (result?.count ?? 0) > 0;
};

/**
 * Mark a notification as dismissed
 */
export const markNotificationDismissed = async (
  db: DbLike,
  reminderId: string,
  eventId: string,
): Promise<void> => {
  await db.runAsync(
    `UPDATE notification_ledger 
     SET dismissed = 1 
     WHERE reminderId = ? AND eventId = ?`,
    [reminderId, eventId],
  );
};

/**
 * Clean up old notification records to prevent database bloat
 * Removes records older than specified days
 */
export const cleanOldRecords = async (db: DbLike, olderThanDays: number = 7): Promise<number> => {
  const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  await db.runAsync(`DELETE FROM notification_ledger WHERE createdAt < ?`, [cutoffTime]);

  // Return 0 since SQLiteDatabase.runAsync doesn't return changes count
  // To get the actual count, we'd need to query before deletion
  return 0;
};

/**
 * Get all notifications for a specific reminder (for debugging/admin)
 */
export const getNotificationsByReminder = async (
  db: DbLike,
  reminderId: string,
): Promise<NotificationLedgerEntry[]> => {
  const rows = await db.getAllAsync<{
    id: string;
    reminderId: string;
    eventId: string;
    source: string;
    sentAt: number;
    dismissed: number;
    createdAt: number;
  }>(
    `SELECT * FROM notification_ledger 
     WHERE reminderId = ? 
     ORDER BY sentAt DESC`,
    [reminderId],
  );

  return rows.map((row) => ({
    id: row.id,
    reminderId: row.reminderId,
    eventId: row.eventId,
    source: row.source as NotificationSource,
    sentAt: row.sentAt,
    dismissed: row.dismissed === 1,
    createdAt: row.createdAt,
  }));
};
