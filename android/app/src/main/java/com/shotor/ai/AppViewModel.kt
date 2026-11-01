package com.shotor.ai

import android.app.Application
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.shotor.ai.data.api.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.HttpException
import com.google.gson.Gson
import androidx.work.*
import java.time.Instant
import java.time.OffsetDateTime
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

 data class AppState(
    val loggedIn:Boolean=false, val email:String="", val loading:Boolean=false, val error:String?=null, val notice:String?=null,
    val documents:List<DocumentDto> = emptyList(), val summaries:Map<String,String> = emptyMap(), val assistantAnswer:String="",
    val gmail:List<GmailMessageDto> = emptyList(), val selectedEmail:GmailMessageDto?=null, val draft:EmailDraftDto?=null,
    val google:GoogleStatusDto?=null, val googleConnectUrl:String?=null, val events:List<CalendarEventDto> = emptyList(), val authMode:String="login"
)

class AppViewModel(application:Application):AndroidViewModel(application) {
    private val api=Api(application)
    private val _state=MutableStateFlow(AppState())
    val state:StateFlow<AppState> = _state
    private val app=application
    init { viewModelScope.launch { val token=api.tokenStorage().get(); if(token!=null) try { val user=api.auth.me(); _state.update{it.copy(loggedIn=true,email=user.email)}; refreshAll() } catch(_:Exception){api.tokenStorage().clear()} } }
    private fun errorMessage(t:Throwable):String {
        if(t is HttpException) {
            val body=try { Gson().fromJson(t.response()?.errorBody()?.string(),ApiErrorDto::class.java)?.detail } catch(_:Exception){null}
            return body ?: when(t.code()){401->"Please sign in again."; 413->"The file is too large."; 429->"Too many requests. Wait and try again."; else->"Request failed (${t.code()}). Please try again."}
        }
        return if(t is java.io.IOException) "Cannot reach the server. Check the backend and your network." else (t.message ?: "Something went wrong.")
    }
    private fun launchRequest(block:suspend()->Unit) { viewModelScope.launch { _state.update{it.copy(loading=true,error=null,notice=null)}; try{block()}catch(t:Throwable){_state.update{it.copy(error=errorMessage(t))}}finally{_state.update{it.copy(loading=false)}} } }
    fun setAuthMode(mode:String){_state.update{it.copy(authMode=mode,error=null)}}
    fun authenticate(email:String,password:String,name:String="") = launchRequest {
        val response=if(_state.value.authMode=="register") api.auth.register(AuthRequest(email,password,name)) else api.auth.login(AuthRequest(email,password))
        api.tokenStorage().save(response.access_token); _state.update{it.copy(loggedIn=true,email=response.user.email,notice="Welcome to Shotor AI",error=null)}; refreshAll()
    }
    fun logout()=launchRequest { try{api.auth.logout()}catch(_:Exception){}; api.tokenStorage().clear(); _state.value=AppState(notice="Signed out") }
    fun refreshAll(){loadDocuments();refreshGoogle()}
    fun loadDocuments()=launchRequest { val docs=api.documents.list();_state.update{it.copy(documents=docs)} }
    fun uploadDocument(uri:Uri)=launchRequest {
        val resolver=app.contentResolver
        val name=resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { c->if(c.moveToFirst())c.getString(0) else "document" } ?: "document"
        val bytes=resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("Cannot read selected document")
        require(bytes.isNotEmpty()){"The selected file is empty."}; require(bytes.size<=10*1024*1024){"Choose a file smaller than 10 MB."}
        val mime=resolver.getType(uri) ?: "application/octet-stream"
        val body=bytes.toRequestBody(mime.toMediaType())
        api.documents.upload(MultipartBody.Part.createFormData("file",name,body))
        _state.update{it.copy(notice="Document uploaded")}; val docs=api.documents.list();_state.update{it.copy(documents=docs)}
    }
    fun summarize(id:String)=launchRequest { val result=api.documents.summarize(id);_state.update{it.copy(summaries=it.summaries+(id to result.summary),notice="Summary ready")} }
    fun deleteDocument(id:String)=launchRequest { val response=api.documents.delete(id);if(!response.isSuccessful) error("Could not delete document");_state.update{it.copy(documents=it.documents.filterNot{d->d.id==id},summaries=it.summaries-id,notice="Document deleted")} }
    fun askAssistant(message:String)=launchRequest { val r=api.assistant.chat(AssistantRequest(message));_state.update{it.copy(assistantAnswer=r.answer)} }
    fun loadGmail()=launchRequest { if(_state.value.google?.connected!=true){_state.update{it.copy(gmail=emptyList())};return@launchRequest}; val result=api.gmail.messages();_state.update{it.copy(gmail=result.messages)} }
    fun openEmail(id:String)=launchRequest { val m=api.gmail.message(id);_state.update{it.copy(selectedEmail=m,draft=null)} }
    fun createDraft(messageId:String,instructions:String)=launchRequest { val d=api.gmail.draft(ReplyDraftRequest(messageId,instructions));_state.update{it.copy(draft=d,notice="Draft generated. Review before sending.")} }
    fun sendDraft(draftId:String,to:String,subject:String,body:String)=launchRequest { api.gmail.send(SendEmailRequest(draftId,to,subject,body,true));_state.update{it.copy(draft=null,notice="Email sent")};loadGmail() }
    fun refreshGoogle()=launchRequest { val g=api.google.status(); _state.update{it.copy(google=g)}; var mail=emptyList<GmailMessageDto>(); var events=emptyList<CalendarEventDto>(); if(g.connected){ try{mail=api.gmail.messages().messages}catch(_:Exception){}; try{events=api.calendar.events().events}catch(_:Exception){} }; _state.update{it.copy(gmail=mail,events=events)}; if(g.connected) scheduleReminders(events) }
    fun connectGoogle()=launchRequest { val url=api.google.connect().authorization_url; _state.update{it.copy(googleConnectUrl=url)} }
    fun clearGoogleConnectUrl(){_state.update{it.copy(googleConnectUrl=null)}}
    fun disconnectGoogle()=launchRequest { val response=api.google.disconnect();if(!response.isSuccessful) error("Could not disconnect Google"); WorkManager.getInstance(app).cancelAllWorkByTag("calendar-reminder"); _state.update{it.copy(google=GoogleStatusDto(false),gmail=emptyList(),events=emptyList(),notice="Google disconnected")} }
    fun loadCalendar()=launchRequest {
        if(_state.value.google?.connected!=true){_state.update{it.copy(events=emptyList())};return@launchRequest}
        val result=api.calendar.events();_state.update{it.copy(events=result.events)}
        scheduleReminders(result.events)
    }
    private fun scheduleReminders(events: List<CalendarEventDto>) {
        viewModelScope.launch(Dispatchers.IO) {
            val manager = WorkManager.getInstance(app)
            val eventIds = events.map { it.id }.toSet()
            try {
                manager.getWorkInfosByTag("calendar-reminder").get().forEach { work ->
                    val oldEventId = work.inputData.getString("event_id")
                    if (oldEventId != null && oldEventId !in eventIds) manager.cancelWorkById(work.id)
                }
            } catch (_: Exception) { }
            val now = System.currentTimeMillis()
            events.forEach { event ->
                val start = try { OffsetDateTime.parse(event.start).toInstant().toEpochMilli() }
                    catch (_: Exception) { try { LocalDate.parse(event.start).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() } catch (_: Exception) { 0L } }
                val delay = start - 30 * 60 * 1000L - now
                if (start > now && delay > 0) {
                    val work = OneTimeWorkRequestBuilder<MeetingReminderWorker>()
                        .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                        .setInputData(workDataOf("event_id" to event.id, "title" to event.summary, "start" to event.start))
                        .addTag("calendar-reminder").build()
                    manager.enqueueUniqueWork("meeting-reminder-${event.id}", ExistingWorkPolicy.REPLACE, work)
                } else {
                    manager.cancelUniqueWork("meeting-reminder-${event.id}")
                }
            }
        }
    }
    fun deleteAccount(password:String)=launchRequest { val response=api.account.delete(AccountDeleteRequest(password));if(response.isSuccessful){api.tokenStorage().clear();WorkManager.getInstance(app).cancelAllWorkByTag("calendar-reminder");_state.value=AppState(notice="Account deleted")}else error("Account deletion failed") }
    fun clearMessage(){_state.update{it.copy(error=null,notice=null)}}
}
