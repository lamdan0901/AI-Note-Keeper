package com.andersonho.ainotekeeper

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteConstraintException
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

    private fun isUniqueConstraint(error: Exception): Boolean {
        if (error is SQLiteConstraintException) {
            return true
        }
        val message = error.message ?: return false
        return message.contains("UNIQUE constraint failed") ||
                message.contains("SQLITE_CONSTRAINT_UNIQUE") ||
                message.contains("SQLITE_CONSTRAINT_PRIMARYKEY") ||
                message.contains("constraint failed")
    }

    private fun recordNotification(context: Context, reminderId: String, eventId: String, source: String): Boolean {
        var db: SQLiteDatabase? = null
        try {
            val dbPath = context.getDatabasePath(DB_NAME)
            db = SQLiteDatabase.openDatabase(
                dbPath.absolutePath,
                null,
                SQLiteDatabase.OPEN_READWRITE
            )

            val id = UUID.randomUUID().toString()
            val now = System.currentTimeMillis()

            db.execSQL(
                """
                INSERT INTO notification_ledger 
                (id, reminderId, eventId, source, sentAt, dismissed, createdAt)
                VALUES (?, ?, ?, ?, ?, 0, ?)
                """,
                arrayOf(id, reminderId, eventId, source, now, now)
            )

            Log.d(TAG, "Recorded notification: source=$source, reminderId=$reminderId, eventId=$eventId")
            return true

        } catch (e: Exception) {
            if (isUniqueConstraint(e)) {
                Log.d(TAG, "Duplicate notification claim suppressed: source=$source, reminderId=$reminderId, eventId=$eventId")
                return false
            }
            Log.e(TAG, "Failed to record notification in ledger", e)
            throw e
        } finally {
            db?.close()
        }
    }

    /**
     * Atomically claim a local-notification event for display.
     */
    fun tryRecordLocalNotification(context: Context, reminderId: String, eventId: String): Boolean {
        return recordNotification(context, reminderId, eventId, "local")
    }

    /**
     * Record an FCM-delivered notification in the ledger.
     * Called from ReminderModule.showNow() so the native ReminderReceiver
     * can see it and skip duplicate display.
     */
    fun tryRecordFcmNotification(context: Context, reminderId: String, eventId: String): Boolean {
        return recordNotification(context, reminderId, eventId, "fcm")
    }

    /**
     * Check if ANY notification (local or FCM) has already been sent for a
     * given reminderId + eventId combo.  Used by both ReminderReceiver and
     * ReminderModule.showNow() to prevent duplicates.
     */
    fun hasNotificationBeenSent(context: Context, reminderId: String, eventId: String): Boolean {
        var db: SQLiteDatabase? = null
        try {
            val dbPath = context.getDatabasePath(DB_NAME)
            db = SQLiteDatabase.openDatabase(
                dbPath.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY
            )

            val cursor = db.rawQuery(
                "SELECT COUNT(*) FROM notification_ledger WHERE reminderId = ? AND eventId = ?",
                arrayOf(reminderId, eventId)
            )
            cursor.use {
                if (it.moveToFirst()) {
                    val count = it.getInt(0)
                    Log.d(TAG, "hasNotificationBeenSent: reminderId=$reminderId, eventId=$eventId, count=$count")
                    return count > 0
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to check notification ledger", e)
        } finally {
            db?.close()
        }
        return false
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
