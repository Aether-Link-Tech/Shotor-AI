package com.shotor.ai

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class MeetingReminderWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork():Result {
        if(Build.VERSION.SDK_INT>=33 && ContextCompat.checkSelfPermission(applicationContext,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return Result.success()
        val manager=applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if(Build.VERSION.SDK_INT>=26) manager.createNotificationChannel(NotificationChannel("meetings","Meeting reminders",NotificationManager.IMPORTANCE_DEFAULT).apply{description="Reminders 30 minutes before upcoming calendar events"})
        val title=inputData.getString("title") ?: "Upcoming meeting"
        val notification=NotificationCompat.Builder(applicationContext,"meetings").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Meeting in 30 minutes").setContentText(title).setPriority(NotificationCompat.PRIORITY_DEFAULT).setAutoCancel(true).build()
        NotificationManagerCompat.from(applicationContext).notify(inputData.getString("event_id")?.hashCode() ?: id.hashCode(),notification)
        return Result.success()
    }
}
