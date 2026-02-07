package com.andersonho.ainotekeeper

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d(TAG, "BOOT_COMPLETED received, starting reminder reschedule service")
            
            val serviceIntent = Intent(context, ReminderTaskService::class.java)
            serviceIntent.action = "ACTION_RESCHEDULE"
            
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                    Log.d(TAG, "Started foreground service for reschedule")
                } else {
                    context.startService(serviceIntent)
                    Log.d(TAG, "Started service for reschedule")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start reminder reschedule service", e)
            }
        }
    }
}
