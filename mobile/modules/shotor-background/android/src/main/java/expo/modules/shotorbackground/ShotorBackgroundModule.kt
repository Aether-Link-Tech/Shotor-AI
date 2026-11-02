package expo.modules.shotorbackground

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ShotorBackgroundModule : Module() {
  private var running = false

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ShotorBackground")

    /** Starts the foreground service. Call while the app is visible (Android forbids starting it from the background). */
    Function("start") { title: String, text: String, progress: Int ->
      val intent = Intent(context, ShotorWorkService::class.java)
        .putExtra(ShotorWorkService.EXTRA_TITLE, title)
        .putExtra(ShotorWorkService.EXTRA_TEXT, text)
        .putExtra(ShotorWorkService.EXTRA_PROGRESS, progress)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
      running = true
    }

    /** Updates the ongoing notification (safe from the background, unlike start). */
    Function("update") { title: String, text: String, progress: Int ->
      if (!running) return@Function
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(ShotorWorkService.NOTIFICATION_ID, ShotorWorkService.buildNotification(context, title, text, progress))
    }

    Function("stop") {
      context.stopService(Intent(context, ShotorWorkService::class.java))
      running = false
    }

    Function("isRunning") { running }
  }
}
