package expo.modules.shotorbackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * A foreground service that only keeps the app process (and CPU) alive while on-device AI work or the
 * model download runs. The work itself happens in the app; this shows the required ongoing notification.
 */
class ShotorWorkService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = buildNotification(this, intent?.getStringExtra(EXTRA_TITLE), intent?.getStringExtra(EXTRA_TEXT), intent?.getIntExtra(EXTRA_PROGRESS, -1) ?: -1)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (wakeLock == null) {
      // Partial wake lock: the screen may turn off, but the CPU keeps working. Released in onDestroy;
      // the timeout is a safety net in case the app is killed without stopping the service.
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Shotor:work")
        .apply { acquire(3 * 60 * 60 * 1000L) }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    const val CHANNEL_ID = "shotor-work"
    const val NOTIFICATION_ID = 7341
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PROGRESS = "progress"

    fun ensureChannel(context: Context) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
          manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Background work", NotificationManager.IMPORTANCE_LOW).apply {
              description = "Shown while Shotor summarises a report or downloads the AI model"
              setShowBadge(false)
            },
          )
        }
      }
    }

    fun buildNotification(context: Context, title: String?, text: String?, progress: Int): Notification {
      ensureChannel(context)
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val tap = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
        .takeIf { it != 0 } ?: context.applicationInfo.icon
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL_ID) else Notification.Builder(context)
      builder
        .setSmallIcon(icon)
        .setContentTitle(title ?: "Shotor AI")
        .setContentText(text ?: "Working…")
        .setContentIntent(tap)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
      if (progress in 0..100) builder.setProgress(100, progress, false) else builder.setProgress(0, 0, true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      return builder.build()
    }
  }
}
