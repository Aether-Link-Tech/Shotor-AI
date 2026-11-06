/**
 * Plain rules for the email assistant (no AI, no phone APIs, so they are unit-tested).
 * The AI sorts mail, but these rules have the final word on what may be answered automatically.
 */

/** Mail that must never get an automatic answer: lists, newsletters, robots, bounces. */
export function isAutomaticMail(headers: Record<string, string>, fromAddr: string): boolean {
  const auto = (headers['auto-submitted'] ?? '').toLowerCase();
  if (auto && auto !== 'no') return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test((headers['precedence'] ?? '').trim())) return true;
  if (headers['list-id'] || headers['list-unsubscribe']) return true;
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-auto-response-suppress']) return true;
  return /(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|alerts?|bounces?|newsletter|news|marketing|billing|invoices?)([._-]|@)/i.test(fromAddr);
}

/** Topics an automatic reply must never handle, whatever the AI thinks: the owner decides these. */
const SENSITIVE =
  /\b(price|pricing|quote|quotation|invoice|payment|pay|paid|refund|discount|contract|agreement|deal|offer|proposal|budget|salary|loan|bank|account number|iban|wire|transfer|legal|lawyer|court|lawsuit|complain|complaint|urgent|asap|deadline|password|confidential|resign|terminate|hire|hiring|fire|approve|approval)\w*/i;

/** Text that tries to give orders to an AI ("ignore previous instructions", "assistant: reply with…"). */
const ORDERS_TO_AI = /\b(ignore (all |any |the )?(previous|prior|above)|instructions? (to|for) (the )?(ai|assistant)|assistant instructions?|system prompt|you are an? (ai|assistant)|classify (this|it)( email| message| mail)? as|as an ai)\b/i;

export function isSensitive(subject: string, body: string): boolean {
  const text = `${subject}\n${body.slice(0, 4000)}`;
  return SENSITIVE.test(text) || ORDERS_TO_AI.test(text);
}

/**
 * Checks an AI-written automatic reply before it may be sent. It must stay a short, neutral
 * acknowledgement: no numbers, money, dates, links or commitments. Anything else goes to the owner.
 */
export function autoReplyProblem(reply: string, ownerNote = ''): string | null {
  const text = reply.trim();
  const note = ownerNote.toLowerCase();
  // Numbers and days are allowed only when the owner wrote them in their auto-reply note (e.g. "away until 12 May").
  const notInNote = (words: string[]) => words.some((w) => !note.includes(w.toLowerCase()));
  if (text.length < 15) return 'too short';
  if (text.length > 900) return 'too long';
  if (notInNote(text.match(/[0-9]+/g) ?? [])) return 'contains numbers or dates';
  if (/[$€£₺¥%]|\b(usd|eur|gbp|dollars?|euros?|pounds?|lira)\b/i.test(text)) return 'mentions money';
  if (/https?:\/\/|www\.|@/i.test(text)) return 'contains a link or address';
  const days =
    text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|next week|january|february|march|april|june|july|august|september|october|november|december)\b/gi) ?? [];
  if (notInNote(days)) return 'mentions a day or date';
  if (/\b(i|we) (agree|accept|approve|confirm|will pay|guarantee|promise|commit)\b/i.test(text)) return 'makes a commitment';
  if (/<\/?[a-z]+>/i.test(text)) return 'contains markup';
  return null;
}

/** Splits a stored JSON list of answer choices safely. */
export function parseOptions(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 3) : [];
  } catch {
    return [];
  }
}

/* ------------------------- why an email is important ------------------------- */

export type Attachment = { name: string; mime: string; size: number; ref: string };
export type Reason = 'file' | 'senior' | 'vip' | 'meeting' | 'sensitive' | 'ai';

/** Real files (proposal, contract, sheet…), not the little logos and icons in signatures. */
export function realFiles(list: Attachment[]): Attachment[] {
  return list.filter((a) => !(a.mime.startsWith('image/') && a.size > 0 && a.size < 60000) && !/\.ics$/i.test(a.name) && a.mime !== 'text/calendar');
}

const TITLES =
  /\b(CEO|Chief Executive(?: Officer)?|COO|CFO|CTO|Chief [A-Z][a-z]+ Officer|Co-?Founder|Founder|Chairman|Chairwoman|Chairperson|Managing Director|Executive Director|Director General|Managing Partner|President|Vice President|VP|Director|Owner|Board Member)\b/;

/** A senior title in the sender's signature (the last lines of their own text, before any quoted mail). */
export function seniorTitle(bodyWithoutQuotes: string): string | null {
  const lines = bodyWithoutQuotes.trim().split('\n').slice(-12);
  for (const l of lines) {
    if (l.length > 90) continue; // a sentence in the message, not a signature line
    const m = TITLES.exec(l);
    if (m) return m[1];
  }
  return null;
}

const MEETING_WORDS = /\b(meet|meeting|call|zoom|teams meeting|google meet|appointment|catch[- ]up|schedule (?:a|the|our)|available (?:on|at|for)|invitation|invite)\b/i;

/** A meeting invite or request. */
export function isMeetingEmail(subject: string, body: string, attachments: Attachment[]): boolean {
  if (attachments.some((a) => /\.ics$/i.test(a.name) || a.mime === 'text/calendar')) return true;
  return MEETING_WORDS.test(`${subject}\n${body.slice(0, 1500)}`);
}

export const REASON_LABEL: Record<Reason, string> = {
  file: '📎 File',
  senior: '👔 Senior sender',
  vip: '⭐ VIP',
  meeting: '📅 Meeting',
  sensitive: '💰 Money / contract / urgent',
  ai: '❓ Needs your decision',
};

export function parseAttachments(json: string | null | undefined): Attachment[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
