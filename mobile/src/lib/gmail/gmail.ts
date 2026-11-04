import NetInfo from '@react-native-community/netinfo';
import { accessToken, AuthExpiredError, isGmailConnected } from './auth';
import { db, notify, setSetting } from '../db';
import { bytesToBase64, fromBase64Url, toBase64Url, utf8Encode } from '../encoding';
import { isAutomaticMail } from '../mail/rules';
import { htmlToText } from '../mail/text';
import { mailProvider } from '../mail/account';
import { sendImap, syncImapInbox } from '../mail/imap';

export { htmlToText };

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export async function isOnline() {
  const s = await NetInfo.fetch();
  return !!s.isConnected && s.isInternetReachable !== false;
}

async function gmailFetch(path: string, init?: RequestInit) {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new AuthExpiredError('Google sign-in expired. Please reconnect Gmail in Settings.');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gmail error ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  return res.json();
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

export function findBody(p: Part, mime: string): string | null {
  if (p.mimeType === mime && p.body?.data) return fromBase64Url(p.body.data);
  for (const c of p.parts ?? []) {
    const r = findBody(c, mime);
    if (r) return r;
  }
  return null;
}


export function parseFrom(v: string) {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim() || m[2], addr: m[2].trim() } : { name: v.trim(), addr: v.trim() };
}

/** Pulls the last 7 days of inbox mail into the local database, from Gmail or from work email (IMAP). */
export async function syncInbox(): Promise<number> {
  if (mailProvider() === 'imap') return syncImapInbox();
  return syncGmailInbox();
}

async function syncGmailInbox(): Promise<number> {
  if (!(await isGmailConnected()) || !(await isOnline())) return 0;
  const list = await gmailFetch(`/messages?maxResults=40&q=${encodeURIComponent('in:inbox newer_than:7d')}`);
  const ids: string[] = (list.messages ?? []).map((m: { id: string }) => m.id);
  let added = 0;
  for (const id of ids) {
    const existing = db.getFirstSync<{ id: string }>('SELECT id FROM emails WHERE id = ?', id);
    const msg = await gmailFetch(existing ? `/messages/${id}?format=minimal` : `/messages/${id}?format=full`);
    const unread = (msg.labelIds ?? []).includes('UNREAD') ? 1 : 0;
    if (existing) {
      db.runSync('UPDATE emails SET unread = ? WHERE id = ?', unread, id);
      continue;
    }
    const headers: Record<string, string> = {};
    for (const h of msg.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
    const from = parseFrom(headers['from'] ?? '');
    const plain = findBody(msg.payload, 'text/plain');
    const body = (plain ?? htmlToText(findBody(msg.payload, 'text/html') ?? msg.snippet ?? '')).slice(0, 50000);
    db.runSync(
      `INSERT OR REPLACE INTO emails (id, thread_id, from_name, from_addr, to_addr, subject, snippet, body, date, unread, message_id_header, references_header, is_bulk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      msg.threadId,
      from.name,
      from.addr,
      headers['to'] ?? '',
      headers['subject'] ?? '(no subject)',
      decodeEntities(msg.snippet ?? ''),
      body,
      Number(msg.internalDate) || Date.now(),
      unread,
      headers['message-id'] ?? null,
      headers['references'] ?? null,
      isAutomaticMail(headers, from.addr) || (msg.labelIds ?? []).some((l: string) => /^CATEGORY_(PROMOTIONS|SOCIAL|UPDATES|FORUMS)$/.test(l)) ? 1 : 0,
    );
    added++;
  }
  // Keep the local cache small: drop mail older than 30 days.
  db.runSync('DELETE FROM emails WHERE date < ?', Date.now() - 30 * 86400000);
  setSetting('mail.lastSync', String(Date.now()));
  notify('emails');
  return added;
}

const decodeEntities = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function encodeHeader(v: string) {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${bytesToBase64(utf8Encode(v))}?=`;
}

export function buildMime(o: { to: string; subject: string; body: string; inReplyTo?: string | null; references?: string | null }) {
  const b64 = bytesToBase64(utf8Encode(o.body)).replace(/(.{76})/g, '$1\r\n');
  const lines = [
    `To: ${o.to}`,
    `Subject: ${encodeHeader(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : '',
    o.inReplyTo ? `References: ${[o.references, o.inReplyTo].filter(Boolean).join(' ')}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
  ].filter((l, i, arr) => l !== '' || i === arr.length - 2);
  return lines.join('\r\n');
}

/* --------------------------------- outbox --------------------------------- */

export type OutboxRow = {
  id: number;
  email_id: string | null;
  thread_id: string | null;
  to_addr: string;
  subject: string;
  body: string;
  in_reply_to: string | null;
  references_header: string | null;
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
  error: string | null;
  attempts: number;
  created_at: number;
  sent_at: number | null;
  send_after: number | null;
  auto: number;
};

/** Saves the approved reply to the Outbox. It is sent now if online, otherwise as soon as the phone is back online. */
export function queueReply(o: {
  emailId: string | null;
  threadId: string | null;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string | null;
  references: string | null;
  /** Automatic reply: wait this long before sending so the owner can cancel. */
  delayMs?: number;
}) {
  const auto = o.delayMs !== undefined;
  const r = db.runSync(
    `INSERT INTO outbox (email_id, thread_id, to_addr, subject, body, in_reply_to, references_header, status, created_at, send_after, auto) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    o.emailId,
    o.threadId,
    o.to,
    o.subject,
    o.body,
    o.inReplyTo,
    o.references,
    Date.now(),
    auto ? Date.now() + (o.delayMs ?? 0) : null,
    auto ? 1 : 0,
  );
  notify('outbox');
  if (auto) setTimeout(() => flushOutbox().catch(() => {}), (o.delayMs ?? 0) + 1000);
  else flushOutbox().catch(() => {});
  return r.lastInsertRowId;
}

let flushing = false;
export async function flushOutbox(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const provider = mailProvider();
    if (!provider || !(await isOnline()) || (provider === 'gmail' && !(await isGmailConnected()))) return { sent, failed };
    // Anything stuck in "sending" (app killed mid-send) goes back to the queue.
    db.runSync(`UPDATE outbox SET status = 'queued' WHERE status = 'sending'`);
    // Automatic replies wait until send_after so the owner has time to cancel them.
    const rows = db.getAllSync<OutboxRow>(`SELECT * FROM outbox WHERE status = 'queued' AND (send_after IS NULL OR send_after <= ?) ORDER BY created_at`, Date.now());
    for (const row of rows) {
      db.runSync(`UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE id = ?`, row.id);
      notify('outbox');
      try {
        if (provider === 'imap') {
          await sendImap({ to: row.to_addr, subject: row.subject, body: row.body, inReplyTo: row.in_reply_to, references: row.references_header });
        } else {
          const raw = toBase64Url(buildMime({ to: row.to_addr, subject: row.subject, body: row.body, inReplyTo: row.in_reply_to, references: row.references_header }));
          await gmailFetch('/messages/send', { method: 'POST', body: JSON.stringify(row.thread_id ? { raw, threadId: row.thread_id } : { raw }) });
        }
        db.runSync(`UPDATE outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`, Date.now(), row.id);
        if (row.email_id) db.runSync('UPDATE emails SET replied = 1 WHERE id = ?', row.email_id);
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const network = /network|fetch|timed? ?out|reach the mail server|internet connection/i.test(msg);
        // Network problems: retry later. Other errors: retry a few times, then show as failed.
        const giveUp = !network && (e instanceof AuthExpiredError || row.attempts + 1 >= 5);
        db.runSync(`UPDATE outbox SET status = ?, error = ? WHERE id = ?`, giveUp ? 'failed' : 'queued', msg, row.id);
        if (giveUp) failed++;
        if (network || e instanceof AuthExpiredError) break;
      }
      notify('outbox', 'emails');
    }
  } finally {
    flushing = false;
    notify('outbox', 'emails');
  }
  return { sent, failed };
}

export function retryOutbox(id: number) {
  db.runSync(`UPDATE outbox SET status = 'queued', attempts = 0, error = NULL WHERE id = ?`, id);
  notify('outbox');
  flushOutbox().catch(() => {});
}

export function deleteOutbox(id: number) {
  db.runSync(`DELETE FROM outbox WHERE id = ? AND status != 'sending'`, id);
  notify('outbox');
}
