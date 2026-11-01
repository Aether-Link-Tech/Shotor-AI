package com.shotor.ai.data.api

import android.content.Context
import com.shotor.ai.BuildConfig
import com.shotor.ai.data.security.TokenStorage
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.util.concurrent.TimeUnit

interface AuthApi {
    @POST("api/v1/auth/register") suspend fun register(@Body body: AuthRequest): TokenDto
    @POST("api/v1/auth/login") suspend fun login(@Body body: AuthRequest): TokenDto
    @GET("api/v1/auth/me") suspend fun me(): UserDto
    @POST("api/v1/auth/logout") suspend fun logout(): retrofit2.Response<Unit>
}
interface DocumentApi {
    @Multipart @POST("api/v1/documents/upload") suspend fun upload(@Part file: MultipartBody.Part): DocumentDto
    @GET("api/v1/documents") suspend fun list(): List<DocumentDto>
    @POST("api/v1/documents/{id}/summarize") suspend fun summarize(@Path("id") id: String): SummaryDto
    @DELETE("api/v1/documents/{id}") suspend fun delete(@Path("id") id: String): retrofit2.Response<Unit>
}
interface AssistantApi { @POST("api/v1/assistant/chat") suspend fun chat(@Body body: AssistantRequest): AssistantDto }
interface GoogleApi {
    @GET("api/v1/google/connect") suspend fun connect(): GoogleConnectDto
    @GET("api/v1/google/status") suspend fun status(): GoogleStatusDto
    @DELETE("api/v1/google/disconnect") suspend fun disconnect(): retrofit2.Response<Unit>
}
interface GmailApi {
    @GET("api/v1/google/gmail/messages") suspend fun messages(@Query("limit_count") limit: Int = 30): GmailListDto
    @GET("api/v1/google/gmail/messages/{id}") suspend fun message(@Path("id") id: String): GmailMessageDto
    @POST("api/v1/google/gmail/reply-draft") suspend fun draft(@Body body: ReplyDraftRequest): EmailDraftDto
    @POST("api/v1/google/gmail/send") suspend fun send(@Body body: SendEmailRequest): SendEmailDto
}
interface CalendarApi { @GET("api/v1/google/calendar/events") suspend fun events(@Query("limit_count") limit: Int = 50): CalendarListDto }
interface AccountApi { @HTTP(method = "DELETE", path = "api/v1/account/me", hasBody = true) suspend fun delete(@Body body: AccountDeleteRequest): retrofit2.Response<Unit> }

class Api(context: Context) {
    private val storage = TokenStorage(context.applicationContext)
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS).addInterceptor(Interceptor { chain ->
        val request = chain.request().newBuilder().apply { storage.get()?.let { header("Authorization", "Bearer $it") } }.build()
        chain.proceed(request)
    }).build()
    private val retrofit = Retrofit.Builder().baseUrl(BuildConfig.API_BASE_URL).client(client).addConverterFactory(GsonConverterFactory.create()).build()
    val auth: AuthApi = retrofit.create(AuthApi::class.java)
    val documents: DocumentApi = retrofit.create(DocumentApi::class.java)
    val assistant: AssistantApi = retrofit.create(AssistantApi::class.java)
    val google: GoogleApi = retrofit.create(GoogleApi::class.java)
    val gmail: GmailApi = retrofit.create(GmailApi::class.java)
    val calendar: CalendarApi = retrofit.create(CalendarApi::class.java)
    val account: AccountApi = retrofit.create(AccountApi::class.java)
    fun tokenStorage() = storage
}
