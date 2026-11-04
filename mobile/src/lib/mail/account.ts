import { getSetting } from '../db';

/** Which mailbox the app uses: Gmail (Google sign-in) or work email over IMAP/SMTP. */
export type MailProvider = 'gmail' | 'imap';

export function mailProvider(): MailProvider | null {
  if (getSetting('google.email')) return 'gmail';
  if (getSetting('imap.email')) return 'imap';
  return null;
}

/** The connected address, whichever kind it is. */
export function mailAccount(): string | null {
  return getSetting('google.email') || getSetting('imap.email') || null;
}
