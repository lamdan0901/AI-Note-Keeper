package com.andersonho.ainotekeeper

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class ReminderReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ReminderReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "onReceive() called - ALARM TRIGGERED!")
        
        val id = intent.getStringExtra("id")
        if (id == null) {
            Log.e(TAG, "onReceive: id is null, returning early")
            return
        }
        
        val title = intent.getStringExtra("title") ?: "Reminder"
        val body = intent.getStringExtra("body") ?: "You have a reminder"
        val eventId = intent.getStringExtra("eventId") ?: ""
        
        Log.d(TAG, "onReceive: id=$id, title=$title, body=$body, eventId=$eventId")

        // Record notification delivery in ledger (Phase 4)
        if (eventId.isNotEmpty()) {
            try {
                NotificationLedgerHelper.recordLocalNotification(context, id, eventId)
                Log.d(TAG, "Recorded notification in ledger")
            } catch (e: Exception) {
                // Log but don't crash - notification should still be shown
                Log.e(TAG, "Failed to record in ledger: ${e.message}", e)
            }
        }

        showNotification(context, id, title, body, eventId)
    }

    private fun showNotification(context: Context, id: String, title: String, body: String, eventId: String) {
        Log.d(TAG, "showNotification: id=$id, title=$title")
        
        // Must match the channel created by Expo JS in notifications.ts
        val channelId = "reminders"
        
        // Ensure channel exists (idempotent – createNotificationChannel is a no-op
        // if the channel already exists with matching ID)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Reminders"
            val descriptionText = "Reminder notifications"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(channelId, name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }

        val notificationId = id.hashCode()

        // Create an Intent to open the app and edit the specific note
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            // Pass note ID as extra - MainActivity will handle creating the deep link
            putExtra("editNoteId", id)
        }
        val pendingIntent: PendingIntent = PendingIntent.getActivity(
            context, 
            0, 
            openIntent, 
            PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)

        // Action: Done
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

        // Action: Delete
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

        // Action: Reschedule
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


        try {
            with(NotificationManagerCompat.from(context)) {
               notify(notificationId, builder.build())
            }
            Log.d(TAG, "Notification displayed successfully: notificationId=$notificationId")
        } catch (e: SecurityException) {
            // Missing POST_NOTIFICATIONS permission on Android 13+
            Log.e(TAG, "SecurityException showing notification (missing POST_NOTIFICATIONS?): ${e.message}", e)
        } catch (e: Exception) {
            Log.e(TAG, "Exception showing notification: ${e.message}", e)
        }
    }
}
