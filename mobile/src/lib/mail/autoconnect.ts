import * as SecureStore from 'expo-secure-store';
import { getSetting, notify, setSetting } from '../db';
import { cleanError, imapNative, IMAP_PASSWORD_KEY, type ImapConfig, type Security, type ServerSettings } from './imap';

/**
 * Finds working mail settings by itself, for any provider that supports IMAP/SMTP:
 * tries the chosen/detected servers first, then the usual server names for the domain,
 * both secure ports, and both login styles (full address, then the part before @).
 * Reading must work. Sending is tried on 465 and 587; if a network blocks both, the account
 * still connects and replies wait in the Outbox until the phone is on a network that allows sending.
 */

type Endpoint = { host: string; port: number; security: Security };
export type Attempt = {
  step: 'reading' | 'sending';
  server: string;
  login: string;
  result: 'ok' | 'password' | 'unreachable' | 'secure' | 'error';
  detail: string;
};

function uniq<T>(list: T[], key: (t: T) => string): T[] {
  return list.filter((t, i) => list.findIndex((u) => key(u) === key(t)) === i);
}

/** Incoming servers: the preferred one first, then imap./mail./bare domain on 993 (SSL) and 143 (STARTTLS). */
export function imapEndpoints(domain: string, preferred?: Endpoint): Endpoint[] {
  const list: Endpoint[] = preferred ? [preferred] : [];
  for (const host of [`imap.${domain}`, `mail.${domain}`, domain]) {
    list.push({ host, port: 993, security: 'ssl' }, { host, port: 143, security: 'starttls' });
  }
  return uniq(list, (e) => `${e.host}:${e.port}`);
}

/** Outgoing servers: the preferred one on both ports first, then smtp./mail./bare domain on 465 (SSL) and 587 (STARTTLS). */
export function smtpEndpoints(domain: string, preferred?: Endpoint): Endpoint[] {
  const list: Endpoint[] = [];
  if (preferred) {
    list.push(preferred, { host: preferred.host, port: 587, security: 'starttls' }, { host: preferred.host, port: 465, security: 'ssl' });
  }
  for (const host of [`smtp.${domain}`, `mail.${domain}`, domain]) {
    list.push({ host, port: 465, security: 'ssl' }, { host, port: 587, security: 'starttls' });
  }
  return uniq(list, (e) => `${e.host}:${e.port}`);
}

export function classify(message: string): Attempt['result'] {
  if (/wrong email or password|refused the sign-in/i.test(message)) return 'password';
  if (/not found|could not reach/i.test(message)) return 'unreachable';
  if (/secure connection/i.test(message)) return 'secure';
  return 'error';
}

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly attempts: Attempt[],
  ) {
    super(message);
  }
}

export async function autoConnect(
  email: string,
  password: string,
  preferred: ServerSettings | null,
  onStep?: (text: string) => void,
): Promise<{ canSend: boolean; attempts: Attempt[] }> {
  const Native = imapNative();
  if (!Native) throw new Error('Work email is not available on this phone yet.');
  const address = email.trim();
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  const logins = uniq([address, address.split('@')[0]], (x) => x);
  const base = { email: address, password, name: getSetting('user.name', '').trim(), timeoutSec: 10 };
  const attempts: Attempt[] = [];
  const deadHosts = new Set<string>();

  async function tryEach(step: Attempt['step'], endpoints: Endpoint[], users: string[], run: (cfg: ImapConfig) => Promise<boolean>) {
    for (const ep of endpoints) {
      if (deadHosts.has(`${step}:${ep.host}`)) continue;
      for (const user of users) {
        onStep?.(`Trying ${step === 'reading' ? 'incoming' : 'outgoing'} server ${ep.host}:${ep.port}…`);
        const cfg: ImapConfig = {
          ...base,
          username: user === address ? '' : user,
          imapHost: ep.host,
          imapPort: ep.port,
          imapSecurity: ep.security,
          smtpHost: ep.host,
          smtpPort: ep.port,
          smtpSecurity: ep.security,
        };
        try {
          await run(cfg);
          attempts.push({ step, server: `${ep.host}:${ep.port}`, login: user, result: 'ok', detail: 'OK' });
          return { ep, user };
        } catch (e) {
          const detail = cleanError(e);
          const result = classify(detail);
          attempts.push({ step, server: `${ep.host}:${ep.port}`, login: user, result, detail });
          if (/not found/i.test(detail)) deadHosts.add(`${step}:${ep.host}`); // no such server name: skip its other port
          if (result !== 'password') break; // another login name only helps when the server answered "wrong password"
        }
      }
    }
    return null;
  }

  const pref = (host?: string, port?: number, security?: Security): Endpoint | undefined => (host ? { host, port: port ?? 993, security: security ?? 'ssl' } : undefined);

  const imap = await tryEach('reading', imapEndpoints(domain, pref(preferred?.imapHost, preferred?.imapPort, preferred?.imapSecurity)), logins, (c) => Native.testImap(c));
  if (!imap) {
    const wrongPassword = attempts.some((a) => a.result === 'password');
    throw new ConnectError(
      wrongPassword
        ? 'The mail server says the email or password is wrong. Check them by signing in to your webmail, then try again.'
        : 'Could not reach a mail server for this address. Check the internet connection, or enter the server settings from your email provider.',
      attempts,
    );
  }

  const smtpUsers = uniq([imap.user, ...logins], (x) => x);
  const smtp = await tryEach('sending', smtpEndpoints(domain, pref(preferred?.smtpHost, preferred?.smtpPort ?? 465, preferred?.smtpSecurity)), smtpUsers, (c) => Native.testSmtp(c));
  const out: Endpoint = smtp?.ep ?? pref(preferred?.smtpHost, preferred?.smtpPort ?? 465, preferred?.smtpSecurity) ?? { host: `smtp.${domain}`, port: 465, security: 'ssl' };

  await SecureStore.setItemAsync(IMAP_PASSWORD_KEY, password);
  setSetting(
    'imap.servers',
    JSON.stringify({
      imapHost: imap.ep.host,
      imapPort: imap.ep.port,
      imapSecurity: imap.ep.security,
      smtpHost: out.host,
      smtpPort: out.port,
      smtpSecurity: out.security,
      username: imap.user === address ? '' : imap.user,
    }),
  );
  setSetting('imap.email', address);
  setSetting('imap.canSend', smtp ? '1' : '0');
  // The assistant looks at the last day of this mailbox first, not older mail.
  setSetting('mail.processSince', String(Date.now() - 86400000));
  notify('settings', 'emails');
  return { canSend: !!smtp, attempts };
}
