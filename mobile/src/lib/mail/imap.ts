import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { db, getSetting, notify, setSetting } from '../db';
import { isAutomaticMail } from './rules';
import { htmlToText } from './text';

/**
 * Work email that is not Gmail (Hostinger, cPanel hosting, Zoho, ...): IMAP to read, SMTP to send,
 * through the native module in modules/shotor-mail (Android). The password is kept in the phone's
 * secure storage and only ever sent to the mail server.
 */

export type Security = 'ssl' | 'starttls' | 'none';
export type ServerSettings = { imapHost: string; imapPort: number; imapSecurity: Security; smtpHost: string; smtpPort: number; smtpSecurity: Security };
export type ImapConfig = ServerSettings & { email: string; password: string; name: string };

type FetchedMail = {
  id: string;
  fromName: string;
  fromAddr: string;
  to: string;
  subject: string;
  date: number;
  unread: boolean;
  known: boolean;
  text: string | null;
  html: string | null;
  headers: Record<string, string | null>;
};
type NativeMail = {
  test(cfg: ImapConfig): Promise<boolean>;
  fetch(cfg: ImapConfig, sinceMs: number, max: number, knownIds: string[]): Promise<FetchedMail[]>;
  send(cfg: ImapConfig, mail: { to: string; subject: string; body: string; inReplyTo: string | null; references: string | null }): Promise<string>;
};
const Native = requireOptionalNativeModule<NativeMail>('ShotorMail');

export const imapSupported = () => Platform.OS === 'android' && !!Native;

/* ------------------------------ server presets ------------------------------ */

const PRESETS: Record<string, ServerSettings & { label: string }> = {
  hostinger: { label: 'Hostinger', imapHost: 'imap.hostinger.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.hostinger.com', smtpPort: 465, smtpSecurity: 'ssl' },
  zoho: { label: 'Zoho Mail', imapHost: 'imap.zoho.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.zoho.com', smtpPort: 465, smtpSecurity: 'ssl' },
  yahoo: { label: 'Yahoo Mail', imapHost: 'imap.mail.yahoo.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecurity: 'ssl' },
};

export type Detected = { provider: string; label: string; settings: ServerSettings; note?: string };

/** cPanel-style hosting usually serves mail on mail.<domain>. */
function genericFor(domain: string): Detected {
  return {
    provider: 'other',
    label: `Mail server for ${domain}`,
    settings: { imapHost: `mail.${domain}`, imapPort: 993, imapSecurity: 'ssl', smtpHost: `mail.${domain}`, smtpPort: 465, smtpSecurity: 'ssl' },
  };
}

const pick = (key: string): Detected => {
  const { label, ...settings } = PRESETS[key];
  return { provider: key, label, settings };
};

/** One-tap choices on the connect screen, for when detection cannot tell. */
export function serverChoices(email: string): Detected[] {
  const domain = email.split('@')[1]?.trim().toLowerCase() || 'example.com';
  return [pick('hostinger'), pick('zoho'), pick('yahoo'), { ...genericFor(domain), label: 'Other (mail.' + domain + ')' }];
}

/** Public DNS-over-HTTPS services, tried in turn (some networks block one of them). */
const DOH = [
  (d: string) => ({ url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=MX`, headers: { accept: 'application/dns-json' } }),
  (d: string) => ({ url: `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=MX`, headers: {} }),
];

async function lookupMx(domain: string): Promise<string> {
  for (const make of DOH) {
    const { url, headers } = make(domain);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const r = await fetch(url, { headers, signal: abort.signal });
      const j = (await r.json()) as { Answer?: { data: string }[] };
      const mx = (j.Answer ?? []).map((a) => a.data).join(' ').toLowerCase();
      if (mx) return mx;
    } catch {
      // Blocked, offline or slow: try the next service.
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

/**
 * Picks server settings from the domain's mail (MX) records. Only the domain is looked up
 * (never the address or password), through public DNS (Cloudflare, then Google).
 */
export async function detectServers(email: string): Promise<Detected> {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  if (!domain) return genericFor('example.com');
  const mx = await lookupMx(domain);
  if (/hostinger/.test(mx)) return pick('hostinger');
  if (/zoho/.test(mx)) return pick('zoho');
  if (/yahoodns/.test(mx)) return pick('yahoo');
  if (/google|googlemail/.test(mx) || /^(gmail|googlemail)\.com$/.test(domain)) {
    return { ...genericFor(domain), provider: 'google', label: 'Google', note: 'This address is on Google. Use “Connect Gmail / Google” instead.' };
  }
  if (/outlook|microsoft/.test(mx)) {
    return { ...genericFor(domain), provider: 'microsoft', label: 'Microsoft 365', note: 'Microsoft 365 mailboxes usually block password sign-in. Ask your IT admin, or contact Aether Link.' };
  }
  return genericFor(domain);
}

/* ------------------------------- the account -------------------------------- */

const KEY_PASSWORD = 'imap.password';

export async function loadImapConfig(): Promise<ImapConfig | null> {
  const email = getSetting('imap.email');
  const raw = getSetting('imap.servers');
  if (!email || !raw) return null;
  const password = (await SecureStore.getItemAsync(KEY_PASSWORD)) ?? '';
  try {
    return { ...(JSON.parse(raw) as ServerSettings), email, password, name: getSetting('user.name', '').trim() };
  } catch {
    return null;
  }
}

/** Checks the sign-in with both servers, then saves the account. Throws a readable message on failure. */
export async function connectImap(cfg: ImapConfig) {
  if (!Native) throw new Error('Work email is not available on this phone yet.');
  try {
    await Native.test(cfg);
  } catch (e) {
    throw new Error(cleanError(e));
  }
  await SecureStore.setItemAsync(KEY_PASSWORD, cfg.password);
  const servers: ServerSettings = {
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    imapSecurity: cfg.imapSecurity,
    smtpHost: cfg.smtpHost,
    smtpPort: cfg.smtpPort,
    smtpSecurity: cfg.smtpSecurity,
  };
  setSetting('imap.servers', JSON.stringify(servers));
  setSetting('imap.email', cfg.email.trim());
  // The assistant looks at the last day of this mailbox first, not older mail.
  setSetting('mail.processSince', String(Date.now() - 86400000));
  notify('settings', 'emails');
}

export async function disconnectImap() {
  await SecureStore.deleteItemAsync(KEY_PASSWORD);
  setSetting('imap.email', null);
  setSetting('imap.servers', null);
  notify('settings', 'emails');
}

/** Expo wraps native errors ("Call to function … has been rejected. → Caused by: …"); keep the useful part. */
export function cleanError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const caused = msg.split(/Caused by:\s*/).pop() ?? msg;
  return caused.replace(/^[\w.]*Exception:\s*/, '').trim() || 'The mail server could not be reached.';
}

async function online() {
  const s = await NetInfo.fetch();
  return !!s.isConnected && s.isInternetReachable !== false;
}

/** Same thread for a whole conversation: the first Message-ID in References, else the one replied to, else its own. */
export function threadKey(h: Record<string, string | null>, fallback: string) {
  const refs = (h['references'] ?? '').split(/\s+/).filter(Boolean);
  return refs[0] ?? h['in-reply-to']?.trim() ?? h['message-id']?.trim() ?? fallback;
}

/** Pulls the last 7 days of the inbox into the local database (like the Gmail sync). */
export async function syncImapInbox(): Promise<number> {
  const cfg = await loadImapConfig();
  if (!cfg || !Native || !(await online())) return 0;
  const since = Date.now() - 7 * 86400000;
  const known = db.getAllSync<{ id: string }>(`SELECT id FROM emails WHERE id LIKE 'imap:%'`).map((r) => r.id);
  let rows: FetchedMail[];
  try {
    rows = await Native.fetch(cfg, since, 40, known);
  } catch (e) {
    throw new Error(cleanError(e));
  }
  let added = 0;
  for (const r of rows) {
    if (r.known) {
      db.runSync('UPDATE emails SET unread = ? WHERE id = ?', r.unread ? 1 : 0, r.id);
      continue;
    }
    const headers = Object.fromEntries(Object.entries(r.headers).filter(([, v]) => v != null)) as Record<string, string>;
    const body = (r.text ?? htmlToText(r.html ?? '')).slice(0, 50000);
    db.runSync(
      `INSERT OR REPLACE INTO emails (id, thread_id, from_name, from_addr, to_addr, subject, snippet, body, date, unread, message_id_header, references_header, is_bulk)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id,
      threadKey(r.headers, r.id),
      r.fromName,
      r.fromAddr,
      r.to,
      r.subject,
      body.replace(/\s+/g, ' ').trim().slice(0, 200),
      body,
      r.date,
      r.unread ? 1 : 0,
      headers['message-id'] ?? null,
      headers['references'] ?? null,
      isAutomaticMail(headers, r.fromAddr) ? 1 : 0,
    );
    added++;
  }
  db.runSync('DELETE FROM emails WHERE date < ?', Date.now() - 30 * 86400000);
  setSetting('mail.lastSync', String(Date.now()));
  notify('emails');
  return added;
}

export async function sendImap(mail: { to: string; subject: string; body: string; inReplyTo: string | null; references: string | null }) {
  const cfg = await loadImapConfig();
  if (!cfg || !Native) throw new Error('Work email is not connected.');
  try {
    return await Native.send(cfg, mail);
  } catch (e) {
    throw new Error(cleanError(e));
  }
}
