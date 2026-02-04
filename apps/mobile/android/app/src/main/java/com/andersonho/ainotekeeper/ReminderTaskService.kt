package com.andersonho.ainotekeeper

import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class ReminderTaskService : HeadlessJsTaskService() {
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
}
