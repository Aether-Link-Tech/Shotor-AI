import * as Notifications from 'expo-notifications';
import { db, getSetting, notify, setSetting } from '../db';
import { draftAutoReply, triageEmail, type EmailCategory } from '../ai/tasks';
import { activeModel } from '../ai/models';
import { cloudStatus } from '../ai/cloud';
import { queueReply } from '../gmail/gmail';
import { beginWork, endWork, updateWork } from '../background';
import { autoReplyProblem, isMeetingEmail, isSensitive, parseAttachments, realFiles, seniorTitle, type Reason } from './rules';
import { stripQuoted } from './redact';
import type { Email } from '../assistant';
import { mailAccount } from './account';

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

/* --------------------------------- VIP list --------------------------------- */

export function isVip(addr: string) {
  return !!db.getFirstSync('SELECT 1 FROM vips WHERE addr = ?', addr.trim().toLowerCase());
}

/** "Always important": mail from this sender is never answered automatically and always alerts at once. */
export function setVip(addr: string, name: string, on: boolean) {
  const a = addr.trim().toLowerCase();
  if (on) db.runSync('INSERT OR REPLACE INTO vips (addr, name, created_at) VALUES (?, ?, ?)', a, name, Date.now());
  else db.runSync('DELETE FROM vips WHERE addr = ?', a);
  notify('emails', 'settings');
}

/** Why an email needs the owner, from plain rules (before and regardless of the AI). */
export function ruleReasons(e: { from_addr: string; subject: string; body: string; attachments: string | null }): { reasons: Reason[]; title: string | null } {
  const own = stripQuoted(e.body);
  const all = parseAttachments(e.attachments);
  const title = seniorTitle(own);
  const reasons: Reason[] = [];
  if (isVip(e.from_addr)) reasons.push('vip');
  if (title) reasons.push('senior');
  if (realFiles(all).length) reasons.push('file');
  if (isMeetingEmail(e.subject, own, all)) reasons.push('meeting');
  if (isSensitive(e.subject, own)) reasons.push('sensitive');
  return { reasons, title };
}

const SUMMARY_ID = 'mail-summary';

/** Removes the "N emails waiting" notification (when the owner opens Mail). */
export function clearMailSummary() {
  Notifications.dismissNotificationAsync(SUMMARY_ID).catch(() => {});
}

let running = false;

export async function processNewEmails(): Promise<{ asked: number; auto: number }> {
  const result = { asked: 0, auto: 0 };
  if (running || (!activeModel() && cloudStatus() !== 'on')) return result;
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

    const me = (mailAccount() ?? '').toLowerCase();
    const owner = getSetting('user.name', '').trim();
    const s = mailSettings();
    const autoSince = Number(getSetting('mail.autoSince', '0'));
    const instant: { id: string; title: string; body: string }[] = [];

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
      // Files, senior senders, VIPs, meetings and money/contract topics always go to the owner.
      const { reasons, title } = ruleReasons({ from_addr: e.from_addr, subject: e.subject, body: e.body || e.snippet, attachments: e.attachments });
      const category: EmailCategory = reasons.length ? 'important' : t.category;
      if (category === 'important' && !reasons.length) reasons.push('ai');

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
            const footer = s.disclose ? `\n\n— Sent by ${owner ? owner + "'s" : 'my'} assistant` : '';
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
      db.runSync('UPDATE emails SET reasons = ? WHERE id = ?', JSON.stringify(reasons), e.id);
      if (handled === 'asked') {
        result.asked++;
        // CEOs, senior people and VIPs: an instant alert as well as the count.
        if (reasons.includes('vip') || reasons.includes('senior')) {
          const files = realFiles(parseAttachments(e.attachments)).length;
          instant.push({
            id: e.id,
            title: `${reasons.includes('vip') ? '⭐' : '👔'} ${e.from_name || e.from_addr}${title ? ` (${title})` : ''}`,
            body: `${t.summary || e.subject}${files ? ` · 📎 ${files} file${files > 1 ? 's' : ''}` : ''}`,
          });
        }
      }
      if (handled === 'auto_replied') result.auto++;
      notify('emails');
    }

    for (const n of instant) {
      await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: { kind: 'mail', url: `/mail/${n.id}` } }, trigger: null }).catch(() => {});
    }
    if (result.asked || result.auto) await postMailSummary(result.auto, s.delayMin);
    return result;
  } finally {
    endWork('mail');
    running = false;
    notify('emails', 'outbox');
  }
}

/** One notification that is replaced each time: "📩 10 emails waiting for you". */
async function postMailSummary(newlyAnswered: number, delayMin: number) {
  const waiting = db.getAllSync<Email>(NEEDS_ANSWER_SQL);
  const answeredToday = autoRepliesToday();
  if (!waiting.length && !newlyAnswered) return;
  const title = waiting.length
    ? `📩 ${waiting.length} email${waiting.length > 1 ? 's' : ''} waiting for you`
    : `Shotor answered ${newlyAnswered} routine email${newlyAnswered > 1 ? 's' : ''}`;
  const lines = waiting.slice(0, 2).map((e) => `${e.from_name || e.from_addr}: ${e.ai_summary || e.subject}`);
  if (waiting.length > 2) lines.push(`…and ${waiting.length - 2} more`);
  if (answeredToday) {
    lines.push(`Shotor answered ${answeredToday} routine email${answeredToday > 1 ? 's' : ''} today${newlyAnswered ? ` (sending in ${delayMin} min, open Mail to cancel)` : ''}`);
  }
  await Notifications.scheduleNotificationAsync({
    identifier: SUMMARY_ID,
    content: { title, body: lines.join(String.fromCharCode(10)), data: { kind: 'mail', url: '/mail' } },
    trigger: null,
  }).catch(() => {});
}
