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

        // ── Dedup check ────────────────────────────────────────────────
        // If the device just came online and the FCM path already showed
        // a notification for this eventId, skip to avoid duplicates.
        if (eventId.isNotEmpty()) {
            try {
                if (NotificationLedgerHelper.hasNotificationBeenSent(context, id, eventId)) {
                    Log.d(TAG, "Notification already sent for eventId=$eventId – skipping")
                    return
                }
            } catch (e: Exception) {
                Log.e(TAG, "Ledger dedup check failed, continuing: ${e.message}", e)
            }
        }

        // Display the notification FIRST, then write to the ledger.
        //
        // Order matters on OEMs (notably MIUI/HyperOS) that may kill this
        // receiver's process mid-flow. If we recorded before displaying and
        // got killed, the ledger would be poisoned with an entry for a
        // notification that never appeared, and the FCM fallback (which
        // checks this same ledger) would suppress itself. Flipping the
        // order makes a partial kill fail open: no ledger write -> FCM
        // wins -> user still gets the reminder.
        NotificationHelper.show(context, id, title, body, eventId)

        if (eventId.isNotEmpty()) {
            try {
                NotificationLedgerHelper.recordLocalNotification(context, id, eventId)
                Log.d(TAG, "Recorded notification in ledger")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to record in ledger: ${e.message}", e)
            }
        }
    }
}
