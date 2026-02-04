package com.andersonho.ainotekeeper

import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationManagerCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    cancelNotificationIfDeepLink(intent)
    handleEditNoteIntent(intent)
    super.onCreate(null)
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    if (intent != null) {
      setIntent(intent)
      handleEditNoteIntent(intent)
    }
    cancelNotificationIfDeepLink(intent)
  }

  override fun getMainComponentName(): String = "main"

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
              val bundle = Bundle()
              val editNoteId = intent?.getStringExtra("editNoteId")
              if (editNoteId != null) {
                android.util.Log.d("MainActivity", "Passing editNoteId to React Native: $editNoteId")
                bundle.putString("editNoteId", editNoteId)
              }
              return bundle
            }
          })
  }

  private fun handleEditNoteIntent(incomingIntent: Intent?) {
    val editNoteId = incomingIntent?.getStringExtra("editNoteId") ?: return
    android.util.Log.d("MainActivity", "Found editNoteId extra: $editNoteId")
    // Set the intent data so React Native Linking module can pick it up
    val deepLinkUri = android.net.Uri.parse("ainotekeeper://edit?noteId=$editNoteId")
    incomingIntent.data = deepLinkUri
    incomingIntent.action = Intent.ACTION_VIEW
    android.util.Log.d("MainActivity", "Set intent data to: ${incomingIntent.data}")
  }

  private fun cancelNotificationIfDeepLink(incomingIntent: Intent?) {
    val data = incomingIntent?.data ?: return
    if (data.scheme != "ainotekeeper") return
    // Handle both reschedule and edit deep links
    if (data.host != "reschedule" && data.host != "edit") return
    val noteId = data.getQueryParameter("noteId") ?: return
    val notificationId = noteId.hashCode()
    NotificationManagerCompat.from(this).cancel(notificationId)
  }

  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      super.invokeDefaultOnBackPressed()
  }
}
