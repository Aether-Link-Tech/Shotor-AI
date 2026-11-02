import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import { getSetting, notify, setSetting } from './db';

/**
 * Meetings live in the phone's own calendar (which syncs Google, Outlook/Exchange and iCloud).
 * Shotor reads them offline and can add, edit and delete meetings there, so they also appear in
 * Google Calendar on other devices once the phone is online.
 */
export type Meeting = {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  location: string;
  allDay: boolean;
  notes: string;
  editable: boolean;
  recurring: boolean;
  color: string;
};

export type MeetingInput = { title: string; start: Date; end: Date; location?: string; notes?: string; reminderMinutes?: number | null };

export async function calendarPermission(ask: boolean) {
  if (ask) return (await Calendar.requestCalendarPermissions()).granted;
  return (await Calendar.getCalendarPermissions()).granted;
}

export async function getMeetings(from: Date, to: Date): Promise<Meeting[]> {
  if (!(await calendarPermission(false))) return [];
  const calendars = (await Calendar.getCalendars(Calendar.EntityTypes.EVENT)).filter((c) => c.isVisible !== false);
  if (!calendars.length) return [];
  const byId = new Map(calendars.map((c) => [String(c.id), c]));
  const events = await Calendar.listEvents(calendars, from, to);
  return events
    .map((e) => {
      const cal = byId.get(String(e.calendarId));
      return {
        id: String(e.id),
        calendarId: String(e.calendarId),
        title: e.title || '(no title)',
        start: new Date(e.startDate as string | Date),
        end: new Date(e.endDate as string | Date),
        location: e.location ?? '',
        allDay: !!e.allDay,
        notes: e.notes ?? '',
        editable: !!cal?.allowsModifications,
        recurring: !!e.recurrenceRule,
        color: cal?.color ?? '#0A1F44',
      };
    })
    .filter((e) => !isNaN(e.start.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  try {
    const e = await Calendar.ExpoCalendarEvent.get(id);
    const cal = await Calendar.ExpoCalendar.get(String(e.calendarId)).catch(() => null);
    return {
      id: String(e.id),
      calendarId: String(e.calendarId),
      title: e.title || '',
      start: new Date(e.startDate as string | Date),
      end: new Date(e.endDate as string | Date),
      location: e.location ?? '',
      allDay: !!e.allDay,
      notes: e.notes ?? '',
      editable: !!cal?.allowsModifications,
      recurring: !!e.recurrenceRule,
      color: cal?.color ?? '#0A1F44',
    };
  } catch {
    return null;
  }
}

export function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function meetingsOnDay(day: Date) {
  const start = startOfDay(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return getMeetings(start, end);
}

export async function todaysMeetings() {
  return meetingsOnDay(new Date());
}

export async function upcomingMeetings(days = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  return getMeetings(now, end);
}

/* ------------------------- choosing where to save ------------------------- */

const LOCAL_CAL_NAME = 'Shotor AI';

export type WritableCalendar = { id: string; title: string; account: string };

export async function writableCalendars(): Promise<WritableCalendar[]> {
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  return cals
    .filter((c) => c.allowsModifications && c.isVisible !== false)
    .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary))
    .map((c) => ({ id: String(c.id), title: c.title, account: c.source?.name ?? c.ownerAccount ?? '' }));
}

/**
 * The calendar new meetings go to: the one the user picked, else the primary Google/Exchange
 * calendar, else a local "Shotor AI" calendar created on the phone (works with no account).
 */
export async function targetCalendarId(): Promise<string> {
  const cals = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const writable = cals.filter((c) => c.allowsModifications);
  const saved = getSetting('calendar.target');
  if (saved && writable.some((c) => String(c.id) === saved)) return saved;
  const pick =
    writable.find((c) => c.isPrimary && /google/i.test(String(c.source?.type ?? ''))) ??
    writable.find((c) => c.isPrimary) ??
    writable.find((c) => /@/.test(c.ownerAccount ?? '') && c.title !== LOCAL_CAL_NAME) ??
    writable.find((c) => c.title === LOCAL_CAL_NAME);
  if (pick) return String(pick.id);
  const created = await Calendar.createCalendar({
    title: LOCAL_CAL_NAME,
    name: LOCAL_CAL_NAME,
    color: '#0A1F44',
    entityType: Calendar.EntityTypes.EVENT,
    ownerAccount: LOCAL_CAL_NAME,
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
    source: { name: LOCAL_CAL_NAME, type: Platform.OS === 'ios' ? Calendar.SourceType.LOCAL : 'LOCAL', isLocalAccount: true },
  });
  return String(created.id);
}

export function setTargetCalendar(id: string) {
  setSetting('calendar.target', id);
}

/* ------------------------------ create / edit ------------------------------ */

function tz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function createMeeting(m: MeetingInput): Promise<string> {
  if (!(await calendarPermission(true))) throw new Error('Calendar access is needed to save meetings.');
  if (m.end.getTime() <= m.start.getTime()) throw new Error('The meeting must end after it starts.');
  const cal = await Calendar.ExpoCalendar.get(await targetCalendarId());
  const event = await cal.createEvent({
    title: m.title.trim() || 'Meeting',
    startDate: m.start,
    endDate: m.end,
    location: m.location?.trim() || undefined,
    notes: m.notes?.trim() || undefined,
    timeZone: tz(),
  });
  const id = String(event.id);
  setMeetingReminder(id, m.reminderMinutes);
  notify('calendar');
  return id;
}

export async function updateMeeting(id: string, m: MeetingInput) {
  if (m.end.getTime() <= m.start.getTime()) throw new Error('The meeting must end after it starts.');
  const e = await Calendar.ExpoCalendarEvent.get(id);
  await e.update({
    title: m.title.trim() || 'Meeting',
    startDate: m.start,
    endDate: m.end,
    location: m.location?.trim() ?? '',
    notes: m.notes?.trim() ?? '',
    timeZone: tz(),
  });
  setMeetingReminder(id, m.reminderMinutes);
  notify('calendar');
}

export async function deleteMeeting(id: string) {
  const e = await Calendar.ExpoCalendarEvent.get(id);
  await e.delete();
  setSetting(`reminder.event.${id}`, null);
  notify('calendar');
}

/** Opens the phone's own calendar editor (used for repeating meetings and read-only calendars). */
export async function openInCalendarApp(id: string) {
  const e = await Calendar.ExpoCalendarEvent.get(id);
  await e.openInCalendar();
  notify('calendar');
}

/* -------------------------------- reminders -------------------------------- */

export function reminderMinutes() {
  return Number(getSetting('reminder.minutes', '15'));
}
export function setReminderMinutes(m: number) {
  setSetting('reminder.minutes', String(m));
  notify('calendar');
}

/** Per-meeting reminder: minutes before, -1 for none, or null to use the default. */
export function meetingReminder(id: string): number {
  const v = getSetting(`reminder.event.${id}`);
  return v === null ? reminderMinutes() : Number(v);
}
export function setMeetingReminder(id: string, minutes: number | null | undefined) {
  setSetting(`reminder.event.${id}`, minutes === null || minutes === undefined ? null : String(minutes));
}

/* -------------------------------- formatting ------------------------------- */

export function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDay(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function meetingLine(m: Pick<Meeting, 'allDay' | 'start' | 'end' | 'title' | 'location'>) {
  const when = m.allDay ? 'All day' : `${formatTime(m.start)}–${formatTime(m.end)}`;
  return `${when} – ${m.title}${m.location ? ` (${m.location})` : ''}`;
}
