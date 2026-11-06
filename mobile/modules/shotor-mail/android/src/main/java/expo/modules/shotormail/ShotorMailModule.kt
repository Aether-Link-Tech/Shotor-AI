package expo.modules.shotormail

import com.sun.mail.imap.IMAPFolder
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Date
import java.util.Properties
import javax.mail.AuthenticationFailedException
import javax.mail.FetchProfile
import javax.mail.Flags
import javax.mail.Folder
import javax.mail.Message
import javax.mail.MessagingException
import javax.mail.Multipart
import javax.mail.Part
import javax.mail.Session
import javax.mail.Store
import javax.mail.UIDFolder
import javax.mail.internet.InternetAddress
import javax.mail.internet.MimeMessage
import javax.mail.internet.MimeUtility
import android.net.Uri
import java.io.File
import javax.mail.search.ComparisonTerm
import javax.mail.search.ReceivedDateTerm
import javax.net.ssl.SSLException

/** Connection settings for a company mailbox (e.g. Hostinger). The password never leaves the phone except to the mail server. */
class MailConfig : Record {
  @Field var email: String = ""
  @Field var password: String = ""
  @Field var name: String = ""
  @Field var imapHost: String = ""
  @Field var imapPort: Int = 993
  /** "ssl" (port 993/465), "starttls" (143/587) or "none" (only for servers inside a company network). */
  @Field var imapSecurity: String = "ssl"
  @Field var smtpHost: String = ""
  @Field var smtpPort: Int = 465
  @Field var smtpSecurity: String = "ssl"
}

class OutgoingMail : Record {
  @Field var to: String = ""
  @Field var subject: String = ""
  @Field var body: String = ""
  @Field var inReplyTo: String? = null
  @Field var references: String? = null
}

class MailError(message: String, cause: Throwable? = null) : CodedException("ERR_MAIL", message, cause)

/**
 * Reads the inbox over IMAP and sends over SMTP, for mailboxes that are not Gmail.
 * AsyncFunctions run off the main thread, so blocking network calls are fine here.
 */
class ShotorMailModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShotorMail")

    /** Signs in to both servers once, so the user learns about a wrong password or server immediately. */
    AsyncFunction("test") { cfg: MailConfig ->
      friendly {
        val session = Session.getInstance(props(cfg))
        openStore(session, cfg).close()
        val t = session.getTransport("smtp")
        try {
          t.connect(cfg.smtpHost, cfg.smtpPort, cfg.email, cfg.password)
        } finally {
          t.close()
        }
      }
      true
    }

    /**
     * Inbox messages received since sinceMs (newest last, at most max). Bodies are skipped for
     * ids the app already has (only the read/unread state is refreshed for those).
     */
    AsyncFunction("fetch") { cfg: MailConfig, sinceMs: Double, max: Int, knownIds: List<String> ->
      friendly {
        val known = knownIds.toHashSet()
        val session = Session.getInstance(props(cfg))
        val store = openStore(session, cfg)
        try {
          val inbox = store.getFolder("INBOX") as IMAPFolder
          inbox.open(Folder.READ_ONLY) // EXAMINE: reading never marks mail as read on the server
          try {
            val validity = inbox.uidValidity
            val found = inbox.search(ReceivedDateTerm(ComparisonTerm.GE, Date(sinceMs.toLong())))
            val recent = found.takeLast(max.coerceIn(1, 200)).toTypedArray()
            val fp = FetchProfile().apply {
              add(FetchProfile.Item.ENVELOPE)
              add(FetchProfile.Item.FLAGS)
              add(UIDFolder.FetchProfileItem.UID)
              for (h in HEADERS) add(h)
            }
            inbox.fetch(recent, fp)
            recent.map { m ->
              val id = "imap:$validity:${inbox.getUID(m)}"
              val from = m.from?.firstOrNull() as? InternetAddress
              val isKnown = known.contains(id)
              val text = if (isKnown) null else find(m, "text/plain")
              val html = if (isKnown || text != null) null else find(m, "text/html")
              mapOf(
                "id" to id,
                "fromName" to (from?.personal ?: from?.address ?: ""),
                "fromAddr" to (from?.address ?: ""),
                "to" to (m.getRecipients(Message.RecipientType.TO)?.joinToString(", ") ?: ""),
                "subject" to (m.subject ?: "(no subject)"),
                "date" to ((m.receivedDate ?: m.sentDate ?: Date()).time.toDouble()),
                "unread" to !m.isSet(Flags.Flag.SEEN),
                "known" to isKnown,
                "text" to text?.take(50000),
                "html" to html?.take(200000),
                "headers" to HEADERS.associate { h -> h.lowercase() to m.getHeader(h)?.firstOrNull() },
                "attachments" to if (isKnown) null else mutableListOf<Map<String, Any?>>().also { attachments(m, "", it) },
              )
            }
          } finally {
            inbox.close(false)
          }
        } finally {
          store.close()
        }
      }
    }

    /** Saves one attachment (found by its part path, e.g. "1" or "1.0") to the app cache and returns its file URI. */
    AsyncFunction("attachment") { cfg: MailConfig, id: String, ref: String ->
      friendly {
        val bits = id.removePrefix("imap:").split(":")
        if (bits.size != 2) throw MailError("This is not a work email.")
        val validity = bits[0].toLong()
        val uid = bits[1].toLong()
        val context = appContext.reactContext ?: throw MailError("The app is not ready. Try again.")
        val session = Session.getInstance(props(cfg))
        val store = openStore(session, cfg)
        try {
          val inbox = store.getFolder("INBOX") as IMAPFolder
          inbox.open(Folder.READ_ONLY)
          try {
            if (inbox.uidValidity != validity) throw MailError("The mailbox changed on the server. Sync and try again.")
            val m = inbox.getMessageByUID(uid) ?: throw MailError("This email is no longer in the inbox.")
            var part: Part = m
            for (idx in ref.split(".").filter { it.isNotEmpty() }.map { it.toInt() }) {
              part = (part.content as Multipart).getBodyPart(idx)
            }
            if (part.size > MAX_ATTACHMENT) throw MailError("This file is larger than 25 MB.")
            val name = (part.fileName?.let { MimeUtility.decodeText(it) } ?: "attachment").replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).ifBlank { "attachment" }
            val dir = File(context.cacheDir, "attachments").apply { mkdirs() }
            val out = File(dir, name)
            part.inputStream.use { input -> out.outputStream().use { input.copyTo(it) } }
            Uri.fromFile(out).toString()
          } finally {
            inbox.close(false)
          }
        } finally {
          store.close()
        }
      }
    }

    /** Sends one message and files a copy in the mailbox's Sent folder. Returns its Message-ID. */
    AsyncFunction("send") { cfg: MailConfig, mail: OutgoingMail ->
      friendly {
        val session = Session.getInstance(props(cfg))
        val msg = MimeMessage(session)
        msg.setFrom(InternetAddress(cfg.email, cfg.name.ifBlank { null }, "UTF-8"))
        msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(mail.to))
        msg.setSubject(mail.subject, "UTF-8")
        msg.setText(mail.body, "UTF-8")
        mail.inReplyTo?.takeIf { it.isNotBlank() }?.let { msg.setHeader("In-Reply-To", it) }
        listOfNotNull(mail.references, mail.inReplyTo).joinToString(" ").trim().takeIf { it.isNotEmpty() }?.let { msg.setHeader("References", it) }
        msg.sentDate = Date()
        msg.saveChanges()
        val t = session.getTransport("smtp")
        try {
          t.connect(cfg.smtpHost, cfg.smtpPort, cfg.email, cfg.password)
          t.sendMessage(msg, msg.allRecipients)
        } finally {
          t.close()
        }
        // Many hosts (Hostinger included) do not keep a copy of SMTP mail; file one so it shows in webmail.
        try {
          saveToSent(session, cfg, msg)
        } catch (_: Exception) {
        }
        msg.messageID ?: ""
      }
    }
  }

  private fun imapProtocol(cfg: MailConfig) = if (cfg.imapSecurity == "ssl") "imaps" else "imap"

  private fun props(cfg: MailConfig) = Properties().apply {
    val p = imapProtocol(cfg)
    put("mail.store.protocol", p)
    put("mail.$p.host", cfg.imapHost)
    put("mail.$p.port", cfg.imapPort.toString())
    put("mail.$p.connectiontimeout", "20000")
    put("mail.$p.timeout", "30000")
    if (cfg.imapSecurity == "starttls") {
      put("mail.imap.starttls.enable", "true")
      put("mail.imap.starttls.required", "true")
    }
    if (cfg.imapSecurity != "none") put("mail.$p.ssl.checkserveridentity", "true")

    put("mail.smtp.host", cfg.smtpHost)
    put("mail.smtp.port", cfg.smtpPort.toString())
    put("mail.smtp.auth", "true")
    put("mail.smtp.connectiontimeout", "20000")
    put("mail.smtp.timeout", "30000")
    put("mail.smtp.writetimeout", "30000")
    when (cfg.smtpSecurity) {
      "ssl" -> {
        put("mail.smtp.ssl.enable", "true")
        put("mail.smtp.ssl.checkserveridentity", "true")
      }
      "starttls" -> {
        put("mail.smtp.starttls.enable", "true")
        put("mail.smtp.starttls.required", "true")
        put("mail.smtp.ssl.checkserveridentity", "true")
      }
    }
  }

  private fun openStore(session: Session, cfg: MailConfig): Store {
    val store = session.getStore(imapProtocol(cfg))
    store.connect(cfg.imapHost, cfg.imapPort, cfg.email, cfg.password)
    return store
  }

  private fun saveToSent(session: Session, cfg: MailConfig, msg: MimeMessage) {
    val store = openStore(session, cfg)
    try {
      val bySpecialUse = store.defaultFolder.list("*").firstOrNull { f ->
        (f as? IMAPFolder)?.attributes?.any { it.equals("\\Sent", ignoreCase = true) } == true
      }
      val sent = bySpecialUse ?: listOf("Sent", "INBOX.Sent", "Sent Items", "Sent Messages").map { store.getFolder(it) }.firstOrNull { it.exists() }
      if (sent != null) {
        msg.setFlag(Flags.Flag.SEEN, true)
        sent.appendMessages(arrayOf(msg))
      }
    } finally {
      store.close()
    }
  }

  /** First non-attachment part of the given type (e.g. text/plain inside multipart/alternative). */
  private fun find(p: Part, mime: String): String? =
    try {
      if (p.isMimeType(mime) && !Part.ATTACHMENT.equals(p.disposition, ignoreCase = true)) {
        p.content as? String
      } else if (p.isMimeType("multipart/*")) {
        val mp = p.content as? Multipart
        var hit: String? = null
        if (mp != null) {
          for (i in 0 until mp.count) {
            hit = find(mp.getBodyPart(i), mime)
            if (hit != null) break
          }
        }
        hit
      } else {
        null
      }
    } catch (_: Exception) {
      null // an unreadable part (odd encoding) should not fail the whole sync
    }

  /** Lists files attached to a message: name, type, size and the part path used to download one later. */
  private fun attachments(p: Part, path: String, out: MutableList<Map<String, Any?>>) {
    try {
      if (p.isMimeType("multipart/*")) {
        val mp = p.content as? Multipart ?: return
        for (i in 0 until mp.count) attachments(mp.getBodyPart(i), if (path.isEmpty()) "$i" else "$path.$i", out)
        return
      }
      val name = p.fileName?.let { MimeUtility.decodeText(it) }
      if (name != null || Part.ATTACHMENT.equals(p.disposition, ignoreCase = true) || p.isMimeType("text/calendar")) {
        out.add(
          mapOf(
            "name" to (name ?: if (p.isMimeType("text/calendar")) "invite.ics" else "attachment"),
            "mime" to (p.contentType ?: "").substringBefore(';').trim().lowercase(),
            "size" to p.size.toDouble(),
            "ref" to path,
          ),
        )
      }
    } catch (_: Exception) {
      // An unreadable part is skipped, not fatal.
    }
  }

  /** Turns mail-library errors into short messages a non-technical user can act on. */
  private inline fun <T> friendly(block: () -> T): T {
    try {
      return block()
    } catch (e: AuthenticationFailedException) {
      throw MailError("Wrong email or password, or the mail server refused the sign-in.", e)
    } catch (e: MessagingException) {
      val c = e.nextException ?: e.cause
      throw MailError(
        when (c) {
          is UnknownHostException -> "Mail server not found. Check the server name and your internet connection."
          is SocketTimeoutException, is ConnectException -> "Could not reach the mail server. Check the server, port and your internet connection."
          is SSLException -> "Secure connection failed. Check the security setting (SSL/TLS or STARTTLS) and port."
          else -> "Mail server error: ${e.message ?: e.javaClass.simpleName}"
        },
        e,
      )
    }
  }

  companion object {
    private const val MAX_ATTACHMENT = 25 * 1024 * 1024
    private val HEADERS = listOf("Message-ID", "In-Reply-To", "References", "List-Id", "List-Unsubscribe", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond")
  }
}
