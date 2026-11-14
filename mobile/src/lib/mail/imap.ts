import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';
import { db, getSetting, notify, setSetting } from '../db';
import { isAutomaticMail, type Attachment } from './rules';
import { htmlToText } from './text';

/**
 * Work email that is not Gmail (Hostinger, cPanel hosting, Zoho, ...): IMAP to read, SMTP to send,
 * through the native module in modules/shotor-mail (Android). The password is kept in the phone's
 * secure storage and only ever sent to the mail server.
 */

export type Security = 'ssl' | 'starttls' | 'none';
export type ServerSettings = { imapHost: string; imapPort: number; imapSecurity: Security; smtpHost: string; smtpPort: number; smtpSecurity: Security };
/** username: login name when the server does not take the full address; timeoutSec: shorter while auto-detecting. */
export type ImapConfig = ServerSettings & { email: string; password: string; name: string; username?: string; timeoutSec?: number };

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
  attachments: Attachment[] | null;
};
type NativeMail = {
  test(cfg: ImapConfig): Promise<boolean>;
  testImap(cfg: ImapConfig): Promise<boolean>;
  testSmtp(cfg: ImapConfig): Promise<boolean>;
  fetch(cfg: ImapConfig, sinceMs: number, max: number, knownIds: string[]): Promise<FetchedMail[]>;
  send(cfg: ImapConfig, mail: { to: string; subject: string; body: string; inReplyTo: string | null; references: string | null }): Promise<string>;
  attachment(cfg: ImapConfig, id: string, ref: string): Promise<string>;
};
const Native = requireOptionalNativeModule<NativeMail>('ShotorMail');

export const imapSupported = () => Platform.OS === 'android' && !!Native;
/** The native mail module (Android), for auto-detection in autoconnect.ts. */
export const imapNative = () => Native;

/* ------------------------------ server presets ------------------------------ */

type Preset = ServerSettings & { label: string; domains?: RegExp; mx?: RegExp; note?: string };

const APP_PASSWORD = (provider: string, where: string) =>
  `${provider} needs an "app password" instead of your normal password: ${where}. Create one there and type it here as the password.`;

/** Known providers: matched by the address's domain or by the domain's mail (MX) records. */
const PRESETS: Record<string, Preset> = {
  hostinger: { label: 'Hostinger', mx: /hostinger/, imapHost: 'imap.hostinger.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.hostinger.com', smtpPort: 465, smtpSecurity: 'ssl' },
  gmail: {
    label: 'Gmail / Google',
    domains: /^(gmail|googlemail)\.com$/,
    mx: /google|googlemail/,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    note: 'Google: easiest is “Connect Gmail / Google” on the Mail screen. To use this form instead, ' + APP_PASSWORD('Google', 'myaccount.google.com → Security → App passwords (needs 2-step verification)'),
  },
  yahoo: {
    label: 'Yahoo Mail',
    domains: /^(yahoo|ymail|rocketmail)\.[a-z.]+$/,
    mx: /yahoodns/,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'ssl',
    note: APP_PASSWORD('Yahoo', 'Yahoo Account Security → Generate app password'),
  },
  icloud: {
    label: 'iCloud Mail',
    domains: /^(icloud|me|mac)\.com$/,
    mx: /icloud\.com|me\.com/,
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    note: APP_PASSWORD('Apple', 'account.apple.com → Sign-In and Security → App-Specific Passwords'),
  },
  aol: { label: 'AOL Mail', domains: /^aol\.com$/, mx: /aol\.com/, imapHost: 'imap.aol.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.aol.com', smtpPort: 465, smtpSecurity: 'ssl', note: APP_PASSWORD('AOL', 'AOL Account Security → Generate app password') },
  zoho: { label: 'Zoho Mail', domains: /^zoho(mail)?\.[a-z.]+$/, mx: /zoho/, imapHost: 'imap.zoho.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.zoho.com', smtpPort: 465, smtpSecurity: 'ssl' },
  godaddy: { label: 'GoDaddy Email', mx: /secureserver\.net/, imapHost: 'imap.secureserver.net', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtpout.secureserver.net', smtpPort: 465, smtpSecurity: 'ssl' },
  namecheap: { label: 'Namecheap Private Email', mx: /privateemail\.com/, imapHost: 'mail.privateemail.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'mail.privateemail.com', smtpPort: 465, smtpSecurity: 'ssl' },
  titan: { label: 'Titan Email', mx: /titan\.email/, imapHost: 'imap.titan.email', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.titan.email', smtpPort: 465, smtpSecurity: 'ssl' },
  rackspace: { label: 'Rackspace Email', mx: /emailsrvr\.com/, imapHost: 'secure.emailsrvr.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'secure.emailsrvr.com', smtpPort: 465, smtpSecurity: 'ssl' },
  gmx: { label: 'GMX', domains: /^gmx\.[a-z.]+$/, mx: /gmx\./, imapHost: 'imap.gmx.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'mail.gmx.com', smtpPort: 587, smtpSecurity: 'starttls' },
  yandex: { label: 'Yandex Mail', domains: /^yandex\.[a-z.]+$/, mx: /yandex/, imapHost: 'imap.yandex.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.yandex.com', smtpPort: 465, smtpSecurity: 'ssl' },
  microsoft: {
    label: 'Outlook / Microsoft 365',
    domains: /^(outlook|hotmail|live|msn)\.[a-z.]+$/,
    mx: /outlook\.com|microsoft/,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    note: 'Microsoft (Outlook, Hotmail, Microsoft 365) has switched off password sign-in for other apps, so this may be refused. A “Sign in with Microsoft” option is planned; contact Aether Link.',
  },
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
  const { label, domains: _d, mx: _m, note, ...settings } = PRESETS[key];
  return { provider: key, label, settings, ...(note ? { note } : {}) };
};

/** The provider for an address, from its domain or its mail (MX) records. */
export function presetFor(domain: string, mx: string): Detected | null {
  for (const key of Object.keys(PRESETS)) if (PRESETS[key].domains?.test(domain)) return pick(key);
  for (const key of Object.keys(PRESETS)) if (mx && PRESETS[key].mx?.test(mx)) return pick(key);
  return null;
}

/** One-tap choices on the connect screen, for when detection cannot tell. */
export function serverChoices(email: string): Detected[] {
  const domain = email.split('@')[1]?.trim().toLowerCase() || 'example.com';
  return [pick('hostinger'), pick('gmail'), pick('yahoo'), pick('zoho'), pick('godaddy'), pick('titan'), { ...genericFor(domain), label: 'Other (mail.' + domain + ')' }];
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
 * Picks server settings from the address's domain or its mail (MX) records. Only the domain is
 * looked up (never the address or password), through public DNS (Cloudflare, then Google).
 * Anything unknown falls back to mail.<domain>, and auto-connect tries the other usual names.
 */
export async function detectServers(email: string): Promise<Detected> {
  const domain = email.split('@')[1]?.trim().toLowerCase() ?? '';
  if (!domain) return genericFor('example.com');
  const byDomain = presetFor(domain, '');
  if (byDomain) return byDomain;
  return presetFor(domain, await lookupMx(domain)) ?? genericFor(domain);
}

/* ------------------------------- the account -------------------------------- */

export const IMAP_PASSWORD_KEY = 'imap.password';
const KEY_PASSWORD = IMAP_PASSWORD_KEY;

export async function loadImapConfig(): Promise<ImapConfig | null> {
  const email = getSetting('imap.email');
  const raw = getSetting('imap.servers');
  if (!email || !raw) return null;
  const password = (await SecureStore.getItemAsync(KEY_PASSWORD)) ?? '';
  try {
    return { ...(JSON.parse(raw) as ServerSettings & { username?: string }), email, password, name: getSetting('user.name', '').trim() };
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
      `INSERT OR REPLACE INTO emails (id, thread_id, from_name, from_addr, to_addr, subject, snippet, body, date, unread, message_id_header, references_header, is_bulk, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(r.attachments ?? []),
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

/** Downloads one attachment of a work email into the app cache (for "Summarise file", read on the phone). */
export async function downloadImapAttachment(emailId: string, a: Attachment): Promise<string> {
  const cfg = await loadImapConfig();
  if (!cfg || !Native) throw new Error('Work email is not connected.');
  if (a.size > 25 * 1024 * 1024) throw new Error('This file is larger than 25 MB.');
  try {
    return await Native.attachment(cfg, emailId, a.ref);
  } catch (e) {
    throw new Error(cleanError(e));
  }
}
