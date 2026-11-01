import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { getSetting, setSetting } from './db';
import { reminderMinutes, upcomingMeetings, formatTime } from './calendar';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const MEETING_CHANNEL = 'meetings';
const BRIEF_CHANNEL = 'brief';
// iOS keeps at most 64 pending local notifications; leave room for the brief and others.
const MAX_MEETING_ALERTS = 50;

export async function setupNotifications(ask: boolean) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(MEETING_CHANNEL, {
      name: 'Meeting reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync(BRIEF_CHANNEL, { name: 'Daily brief', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !ask) return current.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Re-creates local reminders for meetings in the next 7 days. Works fully offline. */
export async function scheduleMeetingReminders() {
  if (!(await Notifications.getPermissionsAsync()).granted) return 0;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((n) => n.content.data?.kind === 'meeting').map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const minutes = reminderMinutes();
  if (minutes < 0) return 0; // reminders switched off
  const now = Date.now();
  const meetings = (await upcomingMeetings(7)).filter((m) => !m.allDay && m.start.getTime() - minutes * 60000 > now).slice(0, MAX_MEETING_ALERTS);
  for (const m of meetings) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: minutes === 0 ? `Starting now: ${m.title}` : `In ${minutes} min: ${m.title}`,
        body: [formatTime(m.start), m.location].filter(Boolean).join(' · '),
        data: { kind: 'meeting', eventId: m.id },
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: m.start.getTime() - minutes * 60000, channelId: MEETING_CHANNEL },
    });
  }
  setSetting('reminder.lastScheduled', String(now));
  return meetings.length;
}

/** A daily "your brief is ready" nudge at the chosen time (default 08:00). */
export async function scheduleDailyBriefNotification() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((n) => n.content.data?.kind === 'brief').map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  const time = getSetting('brief.time', '08:00');
  if (time === 'off' || !(await Notifications.getPermissionsAsync()).granted) return;
  const [hour, minute] = time.split(':').map(Number);
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Your daily brief', body: 'Meetings, email and reports for today — tap to read.', data: { kind: 'brief', url: '/' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: BRIEF_CHANNEL },
  });
}
