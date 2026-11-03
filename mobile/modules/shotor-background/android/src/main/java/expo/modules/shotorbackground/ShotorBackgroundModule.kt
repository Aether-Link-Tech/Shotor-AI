package expo.modules.shotorbackground

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
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

    /** True when Android's battery saver will not stop Shotor's background work. */
    Function("isBatteryUnrestricted") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** Shows Android's "Let app always run in background?" dialog (falls back to the battery settings list). */
    Function("requestBatteryUnrestricted") {
      val starter = appContext.currentActivity ?: context
      try {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))
        if (starter !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        starter.startActivity(intent)
      } catch (e: Exception) {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        if (starter !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        starter.startActivity(intent)
      }
    }
  }
}
