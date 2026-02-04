package com.andersonho.ainotekeeper

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.util.UUID

/**
 * Helper object to record notification deliveries in the SQLite ledger.
 * This works even when the React Native app is killed, allowing BroadcastReceivers
 * to record notification events directly.
 */
object NotificationLedgerHelper {

    private const val TAG = "NotificationLedger"
    private const val DB_NAME = "ai-note-keeper.db"

    /**
     * Record a local notification delivery in the notification ledger.
     * 
     * @param context Android context (from BroadcastReceiver or Service)
     * @param reminderId The ID of the reminder note
     * @param eventId Unique event identifier for deduplication
     */
    fun recordLocalNotification(context: Context, reminderId: String, eventId: String) {
        var db: SQLiteDatabase? = null
        try {
            // Open the database directly
            val dbPath = context.getDatabasePath(DB_NAME)
            db = SQLiteDatabase.openDatabase(
                dbPath.absolutePath,
                null,
                SQLiteDatabase.OPEN_READWRITE
            )

            // Generate UUID for the record
            val id = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()

            // Insert into notification_ledger table
            db.execSQL(
                """
                INSERT INTO notification_ledger 
                (id, reminderId, eventId, source, sentAt, dismissed, createdAt)
                VALUES (?, ?, ?, 'local', ?, 0, ?)
                """,
                arrayOf(id, reminderId, eventId, now, now)
            )

            Log.d(TAG, "Recorded local notification: reminderId=$reminderId, eventId=$eventId")

        } catch (e: Exception) {
            // Log error but don't crash - notification should still be shown
            Log.e(TAG, "Failed to record notification in ledger", e)
        } finally {
            db?.close()
        }
    }

    /**
     * Mark a notification as dismissed in the ledger.
     * 
     * @param context Android context
     * @param reminderId The ID of the reminder note
     * @param eventId Unique event identifier
     */
    fun markNotificationDismissed(context: Context, reminderId: String, eventId: String) {
        var db: SQLiteDatabase? = null
        try {
            val dbPath = context.getDatabasePath(DB_NAME)
            db = SQLiteDatabase.openDatabase(
                dbPath.absolutePath,
                null,
                SQLiteDatabase.OPEN_READWRITE
            )

            db.execSQL(
                """
                UPDATE notification_ledger 
                SET dismissed = 1 
                WHERE reminderId = ? AND eventId = ?
                """,
                arrayOf(reminderId, eventId)
            )

            Log.d(TAG, "Marked notification as dismissed: reminderId=$reminderId, eventId=$eventId")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark notification as dismissed", e)
        } finally {
            db?.close()
        }
    }
}
