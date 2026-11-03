package expo.modules.shotorbackground

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.OpenableColumns
import android.provider.Settings
import java.io.File
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ShotorBackgroundModule : Module() {
  private var running = false
  /** A share that arrived while the app was already open (onNewIntent). */
  private var pendingShare: Intent? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ShotorBackground")

    Events("onShare")

    OnNewIntent { intent ->
      if (isShare(intent)) {
        pendingShare = intent
        sendEvent("onShare", mapOf<String, Any?>())
      }
    }

    /**
     * Returns what was shared to Shotor from another app (once), or null.
     * Files are copied into the app's cache so they can be read after the sharing app lets go of them.
     */
    Function("takeShared") {
      val intent = pendingShare ?: appContext.currentActivity?.intent?.takeIf { isShare(it) }
      pendingShare = null
      if (intent == null) return@Function null
      val result = readShare(intent)
      intent.action = Intent.ACTION_MAIN // never hand out the same share twice
      result
    }

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

  private fun isShare(intent: Intent?) = intent?.action == Intent.ACTION_SEND

  private fun readShare(intent: Intent): Map<String, Any?>? {
    @Suppress("DEPRECATION")
    val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
    if (uri == null) {
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return null
      return mapOf("text" to text, "subject" to intent.getStringExtra(Intent.EXTRA_SUBJECT))
    }
    val resolver = context.contentResolver
    var name = "Shared document"
    var size = -1L
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          c.getString(0)?.let { name = it }
          if (!c.isNull(1)) size = c.getLong(1)
        }
      }
    } catch (_: Exception) {}
    if (size > MAX_BYTES) return mapOf("error" to "This file is larger than 25 MB.", "name" to name)
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val out = File(dir, name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).ifBlank { "document" })
    try {
      resolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
        ?: return mapOf("error" to "Could not open the shared file.", "name" to name)
    } catch (e: Exception) {
      return mapOf("error" to "Could not open the shared file.", "name" to name)
    }
    if (out.length() > MAX_BYTES) {
      out.delete()
      return mapOf("error" to "This file is larger than 25 MB.", "name" to name)
    }
    return mapOf("uri" to Uri.fromFile(out).toString(), "name" to name, "mimeType" to (intent.type ?: resolver.getType(uri)))
  }

  companion object {
    private const val MAX_BYTES = 25L * 1024 * 1024
  }
}
