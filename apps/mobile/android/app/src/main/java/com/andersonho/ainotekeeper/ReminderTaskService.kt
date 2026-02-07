package com.andersonho.ainotekeeper

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class ReminderTaskService : HeadlessJsTaskService() {
    
    companion object {
        private const val FOREGROUND_NOTIFICATION_ID = 999
        private const val CHANNEL_ID = "reminder_task_service"
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Create notification channel for foreground service (Android O+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Background Task Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Service for processing reminder tasks in the background"
            }
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
            
            // Build and show foreground notification
            val notification = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Processing reminders")
                .setContentText("Running background task...")
                .setSmallIcon(applicationInfo.icon)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            
            // Use foregroundServiceType for Android 14+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
            } else {
                startForeground(FOREGROUND_NOTIFICATION_ID, notification)
            }
        }
        
        return super.onStartCommand(intent, flags, startId)
    }
    
    override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
        val extras = intent.extras
        return when (intent.action) {
            "ACTION_DONE" -> {
                val reminderId = extras?.getString("reminderId")
                if (reminderId != null) {
                    val notificationId = reminderId.hashCode()
                    NotificationManagerCompat.from(this).cancel(notificationId)
                }
                val data = extras?.let { Arguments.fromBundle(it) } ?: Arguments.createMap()
                HeadlessJsTaskConfig("ReminderDone", data, 5000, true)
            }
            "ACTION_DELETE" -> {
                val reminderId = extras?.getString("reminderId")
                if (reminderId != null) {
                    val notificationId = reminderId.hashCode()
                    NotificationManagerCompat.from(this).cancel(notificationId)
                }
                val data = extras?.let { Arguments.fromBundle(it) } ?: Arguments.createMap()
                HeadlessJsTaskConfig("ReminderDelete", data, 15000, true)
            }
            "ACTION_RESCHEDULE" -> {
                HeadlessJsTaskConfig(
                    "ReminderReschedule",
                    Arguments.createMap(),
                    30000,
                    true
                )
            }
            else -> null
        }
    }
    
    override fun onHeadlessJsTaskFinish(taskId: Int) {
        // Stop foreground when all tasks complete
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            stopForeground(true)
        }
        super.onHeadlessJsTaskFinish(taskId)
    }
}
