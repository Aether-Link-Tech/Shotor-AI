import * as Notifications from 'expo-notifications';
import { db, getSetting, notify, setSetting } from '../db';
import { draftAutoReply, triageEmail, type EmailCategory } from '../ai/tasks';
import { activeModel } from '../ai/models';
import { queueReply } from '../gmail/gmail';
import { beginWork, endWork, updateWork } from '../background';
import { autoReplyProblem, isSensitive } from './rules';
import type { Email } from '../assistant';

/**
 * The email assistant. For each new email it:
 *  1. skips automatic mail (newsletters, no-reply senders) and the owner's own mail,
 *  2. lets the AI summarise and sort it (important / routine / no reply) and suggest answers,
 *  3. if the owner switched auto-reply on: answers routine mail with a short, checked acknowledgement
 *     that waits a few minutes in the Outbox (so it can be cancelled) before it is sent,
 *  4. asks the owner about everything else, with a summary and one-tap answer choices.
 * Money, contracts, complaints, deadlines and emails that give orders to the AI always go to the owner.
 */

export const AUTO_REPLIES_PER_DAY = 20;
/** Emails sorted per run, so one sync never keeps the phone busy for long. */
const BATCH = 12;

export type MailSettings = { autoReply: boolean; delayMin: number; disclose: boolean; note: string };

export function mailSettings(): MailSettings {
  return {
    autoReply: getSetting('mail.autoReply', '0') === '1',
    delayMin: Number(getSetting('mail.autoDelay', '10')) || 10,
    disclose: getSetting('mail.disclose', '1') === '1',
    note: getSetting('mail.autoNote', ''),
  };
}

export function setAutoReply(on: boolean) {
  setSetting('mail.autoReply', on ? '1' : '0');
  // Only mail that arrives from now on can be answered automatically, never the backlog.
  if (on) setSetting('mail.autoSince', String(Date.now()));
  notify('settings');
}

export function autoRepliesToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM outbox WHERE auto = 1 AND created_at >= ?', start.getTime())?.n ?? 0;
}

/** Emails waiting for the owner's answer (sorted by the assistant, not yet answered or dismissed). */
export const NEEDS_ANSWER_SQL = `SELECT * FROM emails WHERE handled = 'asked' AND replied = 0
  AND id NOT IN (SELECT email_id FROM outbox WHERE email_id IS NOT NULL AND status != 'failed')
  ORDER BY date DESC LIMIT 30`;

export function dismissEmail(id: string) {
  db.runSync(`UPDATE emails SET handled = 'dismissed' WHERE id = ?`, id);
  notify('emails');
}

let running = false;

export async function processNewEmails(): Promise<{ asked: number; auto: number }> {
  const result = { asked: 0, auto: 0 };
  if (running || !activeModel()) return result;
  running = true;
  try {
    // First run: look at the last 24 hours only, not the whole 7-day inbox.
    let since = Number(getSetting('mail.processSince', '0'));
    if (!since) {
      since = Date.now() - 86400000;
      setSetting('mail.processSince', String(since));
    }
    const pending = db.getAllSync<Email & { is_bulk: number }>(
      `SELECT * FROM emails WHERE category IS NULL AND date >= ? ORDER BY date ASC LIMIT ${BATCH}`,
      since,
    );
    if (!pending.length) return result;

    const me = getSetting('google.email', '').toLowerCase();
    const owner = getSetting('user.name', '').trim();
    const s = mailSettings();
    const autoSince = Number(getSetting('mail.autoSince', '0'));
    let firstAsked: { from: string; summary: string } | null = null;

    beginWork('mail', 'Sorting new email', `0 of ${pending.length}`, 0);
    for (const [i, e] of pending.entries()) {
      updateWork('mail', `${i + 1} of ${pending.length}`, Math.round((i / pending.length) * 100));
      const set = (category: EmailCategory, summary: string, options: string[], handled: string) =>
        db.runSync('UPDATE emails SET category = ?, ai_summary = ?, options = ?, handled = ? WHERE id = ?', category, summary, JSON.stringify(options), handled, e.id);

      if (e.is_bulk || (me && e.from_addr.toLowerCase() === me)) {
        set('no_reply', '', [], 'skipped');
        continue;
      }

      let t;
      try {
        t = await triageEmail({ fromName: e.from_name, fromAddr: e.from_addr, subject: e.subject, body: e.body || e.snippet });
      } catch {
        break; // model busy or unavailable: try again on the next sync
      }
      let category = t.category;
      if (category === 'routine' && isSensitive(e.subject, e.body || e.snippet)) category = 'important';

      let handled = category === 'no_reply' || e.replied ? 'skipped' : 'asked';
      const mayAutoReply =
        s.autoReply &&
        category === 'routine' &&
        !e.replied &&
        e.date >= autoSince &&
        autoRepliesToday() < AUTO_REPLIES_PER_DAY &&
        !db.getFirstSync('SELECT 1 FROM outbox WHERE thread_id = ? AND auto = 1', e.thread_id);

      if (mayAutoReply) {
        try {
          const reply = await draftAutoReply({ fromName: e.from_name, fromAddr: e.from_addr, subject: e.subject, body: e.body || e.snippet }, s.note);
          if (!autoReplyProblem(reply, s.note)) {
            const footer = s.disclose ? `\n\n— Automatic reply from ${owner ? owner + "'s" : 'my'} assistant` : '';
            queueReply({
              emailId: e.id,
              threadId: e.thread_id,
              to: e.from_addr,
              subject: /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`,
              body: reply.trim() + footer,
              inReplyTo: e.message_id_header,
              references: e.references_header,
              delayMs: s.delayMin * 60000,
            });
            handled = 'auto_replied';
          }
          // A reply that failed the safety check is not sent: the owner is asked instead.
        } catch {
          // Keep it as "asked".
        }
      }

      set(category, t.summary, t.options, handled);
      if (handled === 'asked') {
        result.asked++;
        firstAsked ??= { from: e.from_name || e.from_addr, summary: t.summary || e.subject };
      }
      if (handled === 'auto_replied') result.auto++;
      notify('emails');
    }

    if (result.asked || result.auto) {
      const title = result.asked
        ? `${result.asked} email${result.asked > 1 ? 's need' : ' needs'} your answer`
        : `Shotor answered ${result.auto} routine email${result.auto > 1 ? 's' : ''}`;
      const body = [
        firstAsked ? `${firstAsked.from}: ${firstAsked.summary}` : '',
        result.auto ? `${result.asked ? `Shotor also answered ${result.auto} routine email${result.auto > 1 ? 's' : ''}. ` : ''}Sending in ${s.delayMin} min — open Mail to cancel.` : '',
      ]
        .filter(Boolean)
        .join('\n');
      await Notifications.scheduleNotificationAsync({ content: { title, body, data: { kind: 'mail', url: '/mail' } }, trigger: null }).catch(() => {});
    }
    return result;
  } finally {
    endWork('mail');
    running = false;
    notify('emails', 'outbox');
  }
}
