import { db, dayKey, getSetting, notify, setSetting } from './db';
import { meetingLine, todaysMeetings, upcomingMeetings } from './calendar';
import { chatSystemPrompt, trimHistory, writeDailyBrief, writeMeetingPrep } from './ai/tasks';
import { generate, type ChatMessage } from './ai/engine';
import { fastGenerate } from './ai/cloud';

export type Report = { id: number; title: string; source: string; original_text: string; summary: string | null; created_at: number };
export type Email = {
  id: string;
  thread_id: string;
  from_name: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  snippet: string;
  body: string;
  date: number;
  unread: number;
  message_id_header: string | null;
  references_header: string | null;
  replied: number;
  /** Set by the email assistant (lib/mail/agent.ts). */
  is_bulk: number;
  category: 'important' | 'routine' | 'no_reply' | null;
  ai_summary: string | null;
  options: string | null;
  handled: 'asked' | 'auto_replied' | 'skipped' | 'dismissed' | null;
  attachments: string | null;
  reasons: string | null;
};

const STOP = new Set('the a an and or of to in on for with is are was were be what which who how when do does did my me i you it this that from at by about'.split(' '));

/** Simple offline relevance search over report summaries (keyword overlap, newest first on ties). */
export function findRelevantReports(query: string, limit = 3): Report[] {
  const words = query.toLowerCase().split(/[^a-z0-9À-￿]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const reports = db.getAllSync<Report>('SELECT * FROM reports WHERE summary IS NOT NULL ORDER BY created_at DESC LIMIT 200');
  if (!words.length) return reports.slice(0, 1);
  return reports
    .map((r) => {
      const hay = (r.title + ' ' + r.summary).toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? (r.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.r.created_at - a.r.created_at)
    .slice(0, limit)
    .map((x) => x.r);
}

function recentEmailLines(limit = 8) {
  return db
    .getAllSync<Email>('SELECT * FROM emails ORDER BY date DESC LIMIT ?', limit)
    .map((e) => `- ${new Date(e.date).toLocaleString()} from ${e.from_name}: "${e.subject}"${e.unread ? ' (unread)' : ''}${e.replied ? ' (replied)' : ''} — ${e.snippet.slice(0, 120)}`)
    .join('\n');
}

export async function sendChatMessage(text: string, onToken: (t: string) => void) {
  const now = Date.now();
  db.runSync(`INSERT INTO chat_messages (role, content, created_at) VALUES ('user', ?, ?)`, text, now);
  notify('chat');

  const meetings = await upcomingMeetings(7).catch(() => []);
  const reports = findRelevantReports(text);
  const system = chatSystemPrompt({
    meetings: meetings.slice(0, 12).map((m) => `- ${m.start.toLocaleDateString()} ${meetingLine(m)}`).join('\n'),
    reports: reports.map((r) => `### ${r.title} (${new Date(r.created_at).toLocaleDateString()})\n${(r.summary ?? '').slice(0, 1400)}`).join('\n\n'),
    emails: recentEmailLines(),
  });
  const history = db
    .getAllSync<{ role: 'user' | 'assistant'; content: string }>('SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 30')
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }) as ChatMessage);

  try {
    // Questions that bring in report content stay on the phone (reports never go online); others use the fast online AI.
    const run = reports.length ? generate : fastGenerate;
    const answer = await run([{ role: 'system', content: system }, ...trimHistory(history, system)], { maxTokens: 700, temperature: 0.5, onToken });
    db.runSync(`INSERT INTO chat_messages (role, content, created_at) VALUES ('assistant', ?, ?)`, answer || '(no answer)', Date.now());
    return answer;
  } finally {
    notify('chat');
  }
}

export function clearChat() {
  db.runSync('DELETE FROM chat_messages');
  notify('chat');
}

/* ------------------------------ daily brief ------------------------------- */

export async function generateDailyBrief(onToken?: (t: string) => void) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since = startOfDay.getTime() - 12 * 3600000; // include last night's mail

  const meetings = await todaysMeetings().catch(() => []);
  const emails = db.getAllSync<Email>('SELECT * FROM emails WHERE date >= ? ORDER BY date DESC LIMIT 25', since);
  const reports = db.getAllSync<Report>('SELECT * FROM reports WHERE created_at >= ? AND summary IS NOT NULL ORDER BY created_at DESC LIMIT 6', startOfDay.getTime() - 86400000);
  const outbox = db.getFirstSync<{ queued: number; failed: number }>(
    `SELECT SUM(status IN ('queued','sending')) AS queued, SUM(status = 'failed') AS failed FROM outbox`,
  );

  const content = await writeDailyBrief(
    {
      meetings: meetings.map((m) => '- ' + meetingLine(m)).join('\n'),
      emails: emails
        .map((e) => `- ${e.from_name}: "${e.subject}"${e.unread ? ' [unread]' : ''}${e.replied ? ' [replied]' : ''} — ${e.snippet.slice(0, 100)}`)
        .join('\n'),
      reports: reports.map((r) => `- ${r.title}: ${(r.summary ?? '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n'),
      outbox: outbox?.queued || outbox?.failed ? `${outbox?.queued ?? 0} waiting to send, ${outbox?.failed ?? 0} failed` : '',
    },
    onToken,
  );
  db.runSync(
    'INSERT INTO briefs (day, content, created_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET content = excluded.content, created_at = excluded.created_at',
    dayKey(),
    content,
    Date.now(),
  );
  notify('briefs');
  return content;
}

export function todaysBrief() {
  return db.getFirstSync<{ content: string; created_at: number }>('SELECT content, created_at FROM briefs WHERE day = ?', dayKey());
}

/* ------------------------------ meeting prep ------------------------------- */

function keywords(text: string) {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9À-￿]+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/** Emails whose sender, subject or text shares words with the meeting (e.g. a company or person name). */
function relatedEmails(query: string, limit = 4): Email[] {
  const words = keywords(query).filter((w) => !['meeting', 'call', 'review', 'sync', 'weekly', 'team'].includes(w));
  if (!words.length) return [];
  return db
    .getAllSync<Email>('SELECT * FROM emails ORDER BY date DESC LIMIT 300')
    .map((e) => {
      const hay = `${e.from_name} ${e.from_addr} ${e.subject} ${e.snippet}`.toLowerCase();
      return { e, score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.date - a.e.date)
    .slice(0, limit)
    .map((x) => x.e);
}

export type MeetingPrep = { text: string; at: number };

export function savedMeetingPrep(meetingId: string): MeetingPrep | null {
  try {
    const v = getSetting(`prep.${meetingId}`);
    return v ? (JSON.parse(v) as MeetingPrep) : null;
  } catch {
    return null;
  }
}

/** A short "prepare me" note for a meeting, built from related report summaries and emails on the phone. */
export async function prepareMeeting(
  meetingId: string,
  m: { title: string; start: Date; end: Date; location: string; notes: string },
  onToken?: (t: string) => void,
) {
  const query = `${m.title} ${m.location} ${m.notes}`;
  const reports = findRelevantReports(query, 2).filter((r) => keywords(m.title).some((w) => (r.title + ' ' + r.summary).toLowerCase().includes(w)));
  const emails = relatedEmails(query);
  const text = await writeMeetingPrep(
    {
      title: m.title,
      when: `${m.start.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })} – ${m.end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
      location: m.location,
      notes: m.notes.slice(0, 1500),
    },
    {
      reports: reports.map((r) => `### From the report "${r.title}"\n${(r.summary ?? '').slice(0, 1300)}`).join('\n\n'),
      emails: emails.map((e) => `- ${new Date(e.date).toLocaleDateString()} from ${e.from_name}: "${e.subject}" — ${(e.body || e.snippet).slice(0, 400)}`).join('\n'),
    },
    onToken,
  );
  setSetting(`prep.${meetingId}`, JSON.stringify({ text, at: Date.now() } satisfies MeetingPrep));
  return text;
}
