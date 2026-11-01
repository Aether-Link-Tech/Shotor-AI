import * as Calendar from 'expo-calendar';
import { getSetting, notify, setSetting } from './db';

/**
 * Meetings come from the phone's own calendar, which already syncs Google, Outlook/Exchange and iCloud.
 * Reading it works offline; nothing is sent anywhere.
 */
export type Meeting = { id: string; title: string; start: Date; end: Date; location: string; allDay: boolean; notes: string };

export async function calendarPermission(ask: boolean) {
  if (ask) return (await Calendar.requestCalendarPermissions()).granted;
  return (await Calendar.getCalendarPermissions()).granted;
}

export async function getMeetings(from: Date, to: Date): Promise<Meeting[]> {
  if (!(await calendarPermission(false))) return [];
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (!calendars.length) return [];
  const events = await Calendar.listEvents(calendars, from, to);
  return events
    .map((e) => ({
      id: String(e.id),
      title: e.title || '(no title)',
      start: new Date(e.startDate as string | Date),
      end: new Date(e.endDate as string | Date),
      location: e.location ?? '',
      allDay: !!e.allDay,
      notes: e.notes ?? '',
    }))
    .filter((e) => !isNaN(e.start.getTime()))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function todaysMeetings() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return getMeetings(start, end);
}

export async function upcomingMeetings(days = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  return getMeetings(now, end);
}

export function formatTime(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function meetingLine(m: Meeting) {
  const when = m.allDay ? 'All day' : `${formatTime(m.start)}–${formatTime(m.end)}`;
  return `${when} – ${m.title}${m.location ? ` (${m.location})` : ''}`;
}

export function reminderMinutes() {
  return Number(getSetting('reminder.minutes', '15'));
}
export function setReminderMinutes(m: number) {
  setSetting('reminder.minutes', String(m));
  notify('calendar');
}
