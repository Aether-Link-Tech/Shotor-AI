package com.shotor.ai

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.*
import androidx.work.*
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){super.onCreate(savedInstanceState)
        if(Build.VERSION.SDK_INT>=33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS),500)
        val periodic=PeriodicWorkRequestBuilder<ReminderSyncWorker>(6,TimeUnit.HOURS).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("calendar-reminder-sync",ExistingPeriodicWorkPolicy.UPDATE,periodic)
        setContent { ShotorApp() }
    }
}

@Composable fun ShotorApp(vm:AppViewModel= viewModel()) {
    val state by vm.state.collectAsState()
    MaterialTheme(colorScheme=lightColorScheme(primary=androidx.compose.ui.graphics.Color(0xFF4659B8),secondary=androidx.compose.ui.graphics.Color(0xFF087F8C),background=androidx.compose.ui.graphics.Color(0xFFF7F8FC))) {
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background) {
            if(!state.loggedIn) AuthScreen(state,vm) else MainDashboard(state,vm)
        }
    }
}

@Composable private fun AuthScreen(s:AppState,vm:AppViewModel) {
    var email by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally) {
        Text("shot or",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.Bold,color=MaterialTheme.colorScheme.primary)
        Text("Your private productivity assistant",style=MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(28.dp))
        Text(if(s.authMode=="login")"Welcome back" else "Create your account",style=MaterialTheme.typography.headlineSmall)
        if(s.authMode=="register") OutlinedTextField(name,{name=it},label={Text("Full name")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        OutlinedTextField(email,{email=it},label={Text("Email")},modifier=Modifier.fillMaxWidth(),singleLine=true)
        OutlinedTextField(password,{password=it},label={Text("Password (12+ characters)")},visualTransformation=PasswordVisualTransformation(),modifier=Modifier.fillMaxWidth(),singleLine=true)
        s.error?.let{Text(it,color=MaterialTheme.colorScheme.error,modifier=Modifier.padding(8.dp))}
        Button(onClick={vm.authenticate(email.trim(),password,name.trim())},enabled=!s.loading&&email.isNotBlank()&&password.isNotBlank(),modifier=Modifier.fillMaxWidth().padding(top=12.dp)){if(s.loading)CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp)else Text(if(s.authMode=="login")"Sign in" else "Create account")}
        TextButton(onClick={vm.setAuthMode(if(s.authMode=="login")"register" else "login")}){Text(if(s.authMode=="login")"New to Shotor? Create an account" else "Already have an account? Sign in")}
    }
}

private val tabs=listOf("Home","Documents","Gmail","Calendar","Settings")
@Composable private fun MainDashboard(s: AppState, vm: AppViewModel) {
    val navController = rememberNavController()
    val entry by navController.currentBackStackEntryAsState()
    val selectedTab = entry?.destination?.route ?: "Home"
    Scaffold(
        bottomBar = {
            NavigationBar {
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = {
                            navController.navigate(tab) {
                                popUpTo(navController.graph.startDestinationId) { saveState = true }
                                launchSingleTop = true
                                restoreState = true
                            }
                            when (tab) {
                                "Documents" -> vm.loadDocuments()
                                "Gmail" -> vm.loadGmail()
                                "Calendar" -> vm.loadCalendar()
                                "Settings" -> vm.refreshGoogle()
                            }
                        },
                        icon = {
                            Icon(
                                when (tab) {
                                    "Home" -> Icons.Default.Home
                                    "Documents" -> Icons.Default.Description
                                    "Gmail" -> Icons.Default.Email
                                    "Calendar" -> Icons.Default.CalendarMonth
                                    else -> Icons.Default.Settings
                                },
                                contentDescription = tab
                            )
                        },
                        label = { Text(tab) }
                    )
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Shotor AI", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(s.email, style = MaterialTheme.typography.bodySmall)
                }
                if (s.loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            }
            s.error?.let { ErrorBanner(it) { vm.clearMessage() } }
            s.notice?.let { Text(it, color = MaterialTheme.colorScheme.secondary, modifier = Modifier.padding(horizontal = 18.dp, vertical = 4.dp)) }
            NavHost(navController = navController, startDestination = "Home", modifier = Modifier.weight(1f)) {
                composable("Home") { HomeScreen(s, vm) }
                composable("Documents") { DocumentsScreen(s, vm) }
                composable("Gmail") { GmailScreen(s, vm) }
                composable("Calendar") { CalendarScreen(s, vm) }
                composable("Settings") { SettingsScreen(s, vm) }
            }
        }
    }
}

@Composable private fun ErrorBanner(text:String,onClose:()->Unit){Card(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=4.dp),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.errorContainer)){Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically){Text(text,Modifier.weight(1f),color=MaterialTheme.colorScheme.onErrorContainer);IconButton(onClick=onClose){Icon(Icons.Default.Close,"Dismiss")}}}}
@Composable private fun HomeScreen(s:AppState,vm:AppViewModel){
    var prompt by remember{mutableStateOf("")}
    LazyColumn(Modifier.fillMaxSize().padding(horizontal=16.dp),verticalArrangement=Arrangement.spacedBy(12.dp),contentPadding=PaddingValues(bottom=24.dp)) {
        item { Card { Column(Modifier.padding(18.dp)){Text("Your day, simplified",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold);Text("Summarize documents, prepare email replies, and stay ready for meetings.",modifier=Modifier.padding(top=6.dp));Row(Modifier.padding(top=12.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){AssistChip(onClick={vm.loadDocuments()},label={Text("${s.documents.size} documents")});AssistChip(onClick={vm.loadCalendar()},label={Text("${s.events.size} upcoming events")})}}} }
        item { Card { Column(Modifier.padding(16.dp)){Text("Ask Shotor",style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);OutlinedTextField(prompt,{prompt=it},modifier=Modifier.fillMaxWidth(),label={Text("What can I help you with?")},minLines=2);Button(onClick={vm.askAssistant(prompt);prompt=""},enabled=prompt.isNotBlank()&&!s.loading,modifier=Modifier.align(Alignment.End).padding(top=8.dp)){Icon(Icons.Default.AutoAwesome,null);Spacer(Modifier.width(6.dp));Text("Ask AI")};if(s.assistantAnswer.isNotBlank()) Text(s.assistantAnswer,modifier=Modifier.padding(top=12.dp))} } }
        item { Card { Column(Modifier.padding(16.dp)){Text("Privacy first",style=MaterialTheme.typography.titleMedium);Text("Your documents and account data are scoped to your account. Google email replies are drafts until you explicitly confirm sending.")}} }
    }
}

@Composable private fun DocumentsScreen(s:AppState,vm:AppViewModel){
    val context= LocalContext.current
    val picker=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri:Uri?->if(uri!=null){context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);vm.uploadDocument(uri)}}
    LazyColumn(Modifier.fillMaxSize().padding(horizontal=16.dp),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=24.dp)) {
        item { Button(onClick={picker.launch(arrayOf("application/pdf","text/plain","application/vnd.openxmlformats-officedocument.wordprocessingml.document"))},modifier=Modifier.fillMaxWidth()){Icon(Icons.Default.UploadFile,null);Spacer(Modifier.width(8.dp));Text("Upload PDF, TXT or DOCX")} }
        item { Text("Your documents",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold) }
        if(s.documents.isEmpty()) item { EmptyCard("No documents yet","Upload a document to get a private AI summary.") }
        items(s.documents,key={it.id}) { doc -> Card { Column(Modifier.padding(14.dp)){Text(doc.original_filename,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Text(doc.created_at,style=MaterialTheme.typography.bodySmall);Row(horizontalArrangement=Arrangement.spacedBy(8.dp),modifier=Modifier.padding(top=8.dp)){Button(onClick={vm.summarize(doc.id)}){Text("Summarize")};OutlinedButton(onClick={vm.deleteDocument(doc.id)}){Text("Delete")}};s.summaries[doc.id]?.let{Text(it,modifier=Modifier.padding(top=10.dp))};doc.summary?.let{if(s.summaries[doc.id]==null)Text(it,modifier=Modifier.padding(top=10.dp))}} } }
    }
}

@Composable private fun GmailScreen(s:AppState,vm:AppViewModel){
    var instructions by remember{mutableStateOf("Write a polite, concise reply and answer the sender's main question.")}
    var editing by remember{mutableStateOf(false)};var recipient by remember{mutableStateOf("")};var subject by remember{mutableStateOf("")};var body by remember{mutableStateOf("")};var confirmSend by remember{mutableStateOf(false)}
    LazyColumn(Modifier.fillMaxSize().padding(horizontal=16.dp),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=24.dp)) {
        item { Row(verticalAlignment=Alignment.CenterVertically){Text("Inbox",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f));IconButton(onClick={vm.loadGmail()}){Icon(Icons.Default.Refresh,"Refresh inbox")}} }
        if(s.google?.connected!=true) item { EmptyCard("Connect Google first","Open Settings and connect a Google account to load your Gmail inbox.") }
        else if(s.gmail.isEmpty()) item { EmptyCard("Inbox is empty","Tap refresh to check for messages.") }
        items(s.gmail,key={it.id}) { msg -> Card(onClick={vm.openEmail(msg.id)}) { Column(Modifier.padding(14.dp)){Text(msg.subject.ifBlank{"(No subject)"},fontWeight=FontWeight.SemiBold);Text(msg.from,style=MaterialTheme.typography.bodySmall);Text(msg.snippet,modifier=Modifier.padding(top=4.dp),maxLines=2)} } }
        s.selectedEmail?.let { msg ->
            item { Card { Column(Modifier.padding(16.dp)){Text("Selected email",style=MaterialTheme.typography.titleMedium);Text(msg.subject,style=MaterialTheme.typography.titleLarge);Text("From: ${msg.from}",style=MaterialTheme.typography.bodySmall);Text(msg.body ?: msg.snippet,modifier=Modifier.padding(vertical=8.dp));OutlinedTextField(instructions,{instructions=it},label={Text("Reply instructions")},modifier=Modifier.fillMaxWidth(),minLines=2);Button(onClick={vm.createDraft(msg.id,instructions)},enabled=!s.loading,modifier=Modifier.padding(top=8.dp)){Text("Generate reply draft")}} } }
        }
    }
    s.draft?.let { d ->
        if(!editing){recipient=d.recipient;subject=d.subject;body=d.body;editing=true}
        AlertDialog(onDismissRequest={editing=false},title={Text("Review reply draft")},text={Column(Modifier.heightIn(max=500.dp).verticalScroll(rememberScrollState())){Text("AI has not sent this email. Review and edit every field.");OutlinedTextField(recipient,{recipient=it},label={Text("Recipient")},modifier=Modifier.fillMaxWidth());OutlinedTextField(subject,{subject=it},label={Text("Subject")},modifier=Modifier.fillMaxWidth());OutlinedTextField(body,{body=it},label={Text("Message")},modifier=Modifier.fillMaxWidth(),minLines=5);Text("Draft expires: ${d.expires_at}",style=MaterialTheme.typography.bodySmall)}},confirmButton={Button(onClick={confirmSend=true},enabled=recipient.contains("@")&&subject.isNotBlank()&&body.isNotBlank()){Text("Review send")}},dismissButton={TextButton(onClick={editing=false;vm.clearMessage()}){Text("Cancel")}})
        if(confirmSend) AlertDialog(onDismissRequest={confirmSend=false},title={Text("Send this email?")},text={Text("To: $recipient\nSubject: $subject\n\nThis action sends the edited message through your connected Gmail account.")},confirmButton={Button(onClick={confirmSend=false;editing=false;vm.sendDraft(d.draft_id,recipient,subject,body)}){Text("Confirm and send")}},dismissButton={TextButton(onClick={confirmSend=false}){Text("Go back")}})
    }
}

@Composable private fun CalendarScreen(s:AppState,vm:AppViewModel){
    LazyColumn(Modifier.fillMaxSize().padding(horizontal=16.dp),verticalArrangement=Arrangement.spacedBy(10.dp),contentPadding=PaddingValues(bottom=24.dp)) {
        item { Row(verticalAlignment=Alignment.CenterVertically){Text("Upcoming meetings",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,modifier=Modifier.weight(1f));IconButton(onClick={vm.loadCalendar()}){Icon(Icons.Default.Refresh,"Refresh calendar")}} }
        item { Text("Local reminders are scheduled for 30 minutes before events. Android may delay background work due to battery and system restrictions.",style=MaterialTheme.typography.bodySmall) }
        if(s.google?.connected!=true) item { EmptyCard("Connect Google first","Connect your Google account in Settings to see Calendar events.") }
        else if(s.events.isEmpty()) item { EmptyCard("No upcoming events","No events were found in the next 7 days.") }
        items(s.events,key={it.id}) { e -> Card { Column(Modifier.padding(14.dp)){Text(e.summary,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold);Text("Starts: ${e.start}");Text("Ends: ${e.end}");e.location?.let{Text(it)};Text("Reminder: 30 minutes before",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.secondary)} } }
    }
}

@Composable private fun SettingsScreen(s: AppState, vm: AppViewModel) {
    val context = LocalContext.current
    var deleteConfirm by remember { mutableStateOf(false) }
    var deletePassword by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Card {
            Column(Modifier.padding(16.dp)) {
                Text("Account", style = MaterialTheme.typography.titleMedium)
                Text(s.email)
                Button(onClick = { vm.logout() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text("Sign out")
                }
            }
        }
        Card {
            Column(Modifier.padding(16.dp)) {
                Text("Google services", style = MaterialTheme.typography.titleMedium)
                Text(if (s.google?.connected == true) "Connected: ${s.google?.google_email ?: "Google account"}" else "Not connected")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    Button(
                        onClick = { vm.connectGoogle() },
                        enabled = !s.loading
                    ) { Text("Connect Google") }
                    OutlinedButton(onClick = { vm.refreshGoogle() }) { Text("Refresh status") }
                }
                if (s.google?.connected == true) {
                    OutlinedButton(onClick = { vm.disconnectGoogle() }) { Text("Disconnect Google") }
                }
            }
        }
        Card {
            Column(Modifier.padding(16.dp)) {
                Text("Account deletion", style = MaterialTheme.typography.titleMedium)
                Text("Permanently delete your Shotor account, documents, drafts, and stored Google connection.")
                Button(
                    onClick = { deleteConfirm = true },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete account") }
            }
        }
        Text("Backend: ${com.shotor.ai.BuildConfig.API_BASE_URL}", style = MaterialTheme.typography.bodySmall)
    }

    LaunchedEffect(s.googleConnectUrl) {
        val url = s.googleConnectUrl
        if (url != null) {
            try { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { }
            vm.clearGoogleConnectUrl()
        }
    }

    if (deleteConfirm) {
        AlertDialog(
            onDismissRequest = { deleteConfirm = false },
            title = { Text("Delete account permanently?") },
            text = {
                Column {
                    Text("Your account and associated Shotor data will be deleted. This cannot be undone.")
                    OutlinedTextField(
                        value = deletePassword,
                        onValueChange = { deletePassword = it },
                        label = { Text("Confirm with your password") },
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { deleteConfirm = false; vm.deleteAccount(deletePassword); deletePassword = "" },
                    enabled = deletePassword.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete permanently") }
            },
            dismissButton = { TextButton(onClick = { deleteConfirm = false }) { Text("Cancel") } }
        )
    }
}

@Composable private fun EmptyCard(title:String,body:String){Card { Column(Modifier.fillMaxWidth().padding(20.dp),horizontalAlignment=Alignment.CenterHorizontally){Icon(Icons.Default.Inbox,null,tint=MaterialTheme.colorScheme.secondary,modifier=Modifier.size(32.dp));Text(title,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold,modifier=Modifier.padding(top=8.dp));Text(body,style=MaterialTheme.typography.bodyMedium,modifier=Modifier.padding(top=4.dp))} } }
