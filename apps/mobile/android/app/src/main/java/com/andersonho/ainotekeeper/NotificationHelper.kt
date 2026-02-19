package com.andersonho.ainotekeeper

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Shared notification builder used by both ReminderReceiver (offline / local alarm)
 * and ReminderModule.showNow() (online / FCM-triggered).
 *
 * Ensures every notification has the same look: app icon, action buttons
 * (Done, Delete, Reschedule), sound, and channel regardless of source.
 */
object NotificationHelper {

    private const val TAG = "NotificationHelper"
    private const val CHANNEL_ID = "reminders"

    fun show(context: Context, id: String, title: String, body: String, eventId: String) {
        Log.d(TAG, "show: id=$id, title=$title")

        ensureChannel(context)

        val notificationId = id.hashCode()

        // Tap intent – opens the note in the app
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("editNoteId", id)
        }
        val contentPendingIntent: PendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(contentPendingIntent)
            .setAutoCancel(true)

        // ── Action: Done ──
        val doneIntent = Intent(context, ReminderTaskService::class.java).apply {
            action = "ACTION_DONE"
            putExtra("reminderId", id)
        }
        val donePendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PendingIntent.getForegroundService(
                context,
                id.hashCode() + 1,
                doneIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else {
            PendingIntent.getService(
                context,
                id.hashCode() + 1,
                doneIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        builder.addAction(android.R.drawable.ic_menu_agenda, "Done", donePendingIntent)

        // ── Action: Delete ──
        val deleteIntent = Intent(context, ReminderTaskService::class.java).apply {
            action = "ACTION_DELETE"
            putExtra("reminderId", id)
        }
        val deletePendingIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PendingIntent.getForegroundService(
                context,
                id.hashCode() + 3,
                deleteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        } else {
            PendingIntent.getService(
                context,
                id.hashCode() + 3,
                deleteIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        builder.addAction(android.R.drawable.ic_menu_delete, "Delete", deletePendingIntent)

        // ── Action: Reschedule ──
        val rescheduleIntent = Intent(context, RescheduleActivity::class.java).apply {
            putExtra("noteId", id)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        val reschedulePendingIntent = PendingIntent.getActivity(
            context,
            id.hashCode() + 2,
            rescheduleIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        builder.addAction(android.R.drawable.ic_menu_recent_history, "Reschedule", reschedulePendingIntent)

        // ── Show ──
        try {
            NotificationManagerCompat.from(context).notify(notificationId, builder.build())
            Log.d(TAG, "Notification displayed: notificationId=$notificationId")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException (missing POST_NOTIFICATIONS?): ${e.message}", e)
        } catch (e: Exception) {
            Log.e(TAG, "Exception showing notification: ${e.message}", e)
        }
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Reminders",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Reminder notifications"
            }
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }
}
