package com.andersonho.ainotekeeper

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ReminderModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "ReminderModule"
    }

    override fun getName(): String {
        return "ReminderModule"
    }

    @ReactMethod
    fun schedule(id: String, triggerAt: Double, title: String, body: String, eventId: String) {
        Log.d(TAG, "schedule() called: id=$id, triggerAt=$triggerAt, title=$title, eventId=$eventId")
        
        val context = reactApplicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        
        // Check exact alarm permission on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val canSchedule = alarmManager.canScheduleExactAlarms()
            Log.d(TAG, "canScheduleExactAlarms: $canSchedule")
            if (!canSchedule) {
                Log.e(TAG, "EXACT_ALARM permission not granted! Alarm may not fire.")
            }
        }
        
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra("id", id)
            putExtra("title", title)
            putExtra("body", body)
            putExtra("eventId", eventId)
        }

        // Use a consistent ID generation strategy. 
        // Hash the string ID to get an Int for PendingIntent
        val pendingIntentId = id.hashCode()
        
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            pendingIntentId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        try {
            // schedule exact alarm
            val triggerMs = triggerAt.toLong()
            val nowMs = System.currentTimeMillis()
            Log.d(TAG, "Scheduling alarm: triggerMs=$triggerMs, now=$nowMs, diff=${(triggerMs - nowMs) / 1000}s")
            
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerMs,
                pendingIntent
            )
            Log.d(TAG, "Alarm scheduled successfully for id=$id at $triggerMs")
        } catch (e: SecurityException) {
            // Handle permission denial appropriately or log.
            // On Android 12+, we need SCHEDULE_EXACT_ALARM permission.
            Log.e(TAG, "SecurityException scheduling alarm: ${e.message}", e)
        } catch (e: Exception) {
            Log.e(TAG, "Exception scheduling alarm: ${e.message}", e)
        }
    }

    @ReactMethod
    fun cancel(id: String) {
        val context = reactApplicationContext
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, ReminderReceiver::class.java)
        
        val pendingIntentId = id.hashCode()
        
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            pendingIntentId,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )

        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
        }
    }

    @ReactMethod
    fun hasExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            promise.resolve(alarmManager.canScheduleExactAlarms())
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val context = reactApplicationContext
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            intent.data = Uri.parse("package:" + context.packageName)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
        }
    }
}
