package com.andersonho.ainotekeeper

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

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

        // Atomically claim this eventId before showing. If another path
        // already claimed it (FCM/local race), skip duplicate display.
        if (eventId.isNotEmpty()) {
            try {
                val claimed = NotificationLedgerHelper.tryRecordLocalNotification(context, id, eventId)
                if (!claimed) {
                    Log.d(TAG, "Notification already claimed for eventId=$eventId - skipping")
                    return
                }
            } catch (e: Exception) {
                Log.e(TAG, "Ledger claim failed, continuing: ${e.message}", e)
            }
        }

        // Delegate to shared helper so the notification looks identical
        // regardless of whether it came from a local alarm or FCM.
        NotificationHelper.show(context, id, title, body, eventId)
    }
}
