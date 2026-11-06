import * as chrono from 'chrono-node';

/**
 * Turns "Board call with Ali tomorrow 3pm at HQ" into meeting fields — instantly and offline, with no AI model.
 * Dates/times come from chrono-node (a dedicated date parser; an AI model got times wrong in testing),
 * then simple business rules: 1–7 o'clock without am/pm means afternoon, day/month order outside the US.
 * The result always opens in the meeting form for the user to check.
 */
export type ParsedMeeting = { title: string; start: Date; end: Date; location: string; hasTime: boolean };

const DURATION = /\bfor\s+(?:(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b|(an?|one)\s+hour|half\s+an\s+hour)/i;
const LOCATION = /\s(?:at|in|@|on)\s+((?!\d)[^,]+?)\s*$/i;

function dayFirst(locale?: string) {
  const l = locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return !/^en-US$/i.test(l);
}

export function parseMeeting(input: string, now = new Date(), opts: { locale?: string; defaultDay?: Date } = {}): ParsedMeeting {
  let text = ` ${input.replace(/\s+/g, ' ').trim()} `;

  // Duration ("for 90 minutes", "for 2 hours", "for an hour").
  let minutes = 60;
  const d = text.match(DURATION);
  if (d) {
    if (d[1]) {
      const n = parseFloat(d[1].replace(',', '.'));
      minutes = /^h/i.test(d[2]) ? Math.round(n * 60) : Math.round(n);
    } else minutes = /half/i.test(d[0]) ? 30 : 60;
    minutes = Math.min(Math.max(minutes, 5), 12 * 60);
    text = text.replace(d[0], ' ');
  }

  // Date and time.
  const parser = dayFirst(opts.locale) ? chrono.en.GB : chrono.en;
  const result = parser.parse(text, now, { forwardDate: true })[0];
  let start: Date;
  let hasTime = false;
  if (result) {
    start = result.start.date();
    hasTime = result.start.isCertain('hour');
    if (hasTime && !result.start.isCertain('meridiem')) {
      const h = start.getHours();
      if (h >= 1 && h <= 7) start.setHours(h + 12); // "at 3" in a work calendar means 15:00
    }
    if (!hasTime) start.setHours(9, 0, 0, 0);
    text = text.slice(0, result.index) + ' ' + text.slice(result.index + result.text.length);
  } else {
    // No date given: the selected day (or today) at the next full hour.
    start = new Date(opts.defaultDay ?? now);
    const base = new Date(now);
    start.setHours(base.getMinutes() > 0 ? base.getHours() + 1 : base.getHours(), 0, 0, 0);
  }
  start.setSeconds(0, 0);

  // Place: the last "at/in/@ <words>" left after removing the date ("at HQ", "in room 4", "at Hilton").
  let location = '';
  text = text.replace(/\s+/g, ' ').trimEnd();
  const loc = text.match(LOCATION);
  if (loc && loc[1].trim().length > 1) {
    location = loc[1].trim();
    text = text.slice(0, loc.index);
  }

  // Title: what is left, tidied ("Board call with Ali").
  let title = text
    .replace(/\s+/g, ' ')
    .replace(/\s(?:at|on|in|for|from|by|the)$/i, '')
    .trim();
  title = title ? title[0].toUpperCase() + title.slice(1) : 'Meeting';

  return { title, start, end: new Date(start.getTime() + minutes * 60000), location, hasTime };
}

/** The first future date with a time mentioned in an email, for "Add to calendar" (1 hour by default). */
export function findMeetingTime(text: string, sentAt: Date, locale?: string): { start: Date; end: Date } | null {
  const parser = (locale ?? Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase() === 'en-us' ? chrono.en : chrono.en.GB;
  for (const r of parser.parse(text.slice(0, 3000), sentAt, { forwardDate: true })) {
    if (!r.start.isCertain('hour')) continue;
    const start = r.start.date();
    if (start.getTime() < sentAt.getTime() - 3600000) continue;
    const end = r.end?.date() ?? new Date(start.getTime() + 3600000);
    return { start, end: end > start ? end : new Date(start.getTime() + 3600000) };
  }
  return null;
}
