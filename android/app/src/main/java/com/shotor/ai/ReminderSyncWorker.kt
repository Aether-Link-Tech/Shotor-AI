package com.shotor.ai

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.shotor.ai.data.api.Api
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

class ReminderSyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
    override suspend fun doWork():Result {
        if(Api(applicationContext).tokenStorage().get()==null) return Result.success()
        return try {
            val events=Api(applicationContext).calendar.events(100).events
            val manager = WorkManager.getInstance(applicationContext)
            val eventIds = events.map { it.id }.toSet()
            manager.getWorkInfosByTag("calendar-reminder").get().forEach { work ->
                val oldEventId = work.inputData.getString("event_id")
                if (oldEventId != null && oldEventId !in eventIds) manager.cancelWorkById(work.id)
            }
            val now=System.currentTimeMillis()
            events.forEach { event ->
                val start=try { OffsetDateTime.parse(event.start).toInstant().toEpochMilli() } catch(_:Exception) { try { LocalDate.parse(event.start).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() } catch(_:Exception){0L} }
                val delay=start-30*60*1000L-now
                if(start>now && delay>0) {
                    val request=OneTimeWorkRequestBuilder<MeetingReminderWorker>().setInitialDelay(delay,TimeUnit.MILLISECONDS).setInputData(workDataOf("event_id" to event.id,"title" to event.summary,"start" to event.start)).addTag("calendar-reminder").build()
                    manager.enqueueUniqueWork("meeting-reminder-${event.id}",ExistingWorkPolicy.REPLACE,request)
                } else {
                    manager.cancelUniqueWork("meeting-reminder-${event.id}")
                }
            }
            Result.success()
        } catch(_:Exception) { Result.retry() }
    }
}
