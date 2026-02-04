package com.andersonho.ainotekeeper

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import android.os.Bundle
import androidx.core.app.NotificationManagerCompat

class RescheduleActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // Apply transparent theme
    setTheme(R.style.Theme_Transparent)
    super.onCreate(savedInstanceState)
    cancelNotification()
  }

  private fun cancelNotification() {
    val noteId = intent.getStringExtra("noteId")
    if (noteId != null) {
      val notificationId = noteId.hashCode()
      try {
        NotificationManagerCompat.from(this).cancel(notificationId)
      } catch (e: Exception) {
        // Ignore errors if notification cannot be cancelled
      }
    }
  }

  override fun getMainComponentName(): String = "RescheduleOverlay"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){
            override fun getLaunchOptions(): Bundle? {
              val initialProps = Bundle()
              val noteId = intent.getStringExtra("noteId")
              if (noteId != null) {
                initialProps.putString("noteId", noteId)
              }
              return initialProps
            }
          })
  }
}
