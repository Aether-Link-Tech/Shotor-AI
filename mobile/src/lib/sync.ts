import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import NetInfo from '@react-native-community/netinfo';
import { flushOutbox, syncInbox } from './gmail/gmail';
import { scheduleMeetingReminders } from './notifications';
import { migrate } from './db';
import { processNewEmails } from './mail/agent';

export const SYNC_TASK = 'shotor-sync';

/** Online work: send queued mail, refresh inbox, let the email assistant sort new mail. Offline work: meeting reminders. */
export async function runSync() {
  const results = await Promise.allSettled([flushOutbox(), syncInbox().then(() => processNewEmails()), scheduleMeetingReminders()]);
  return results;
}

// Must be defined at module scope so the OS can wake the app for it.
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    migrate();
    await runSync();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync() {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) {
    // The OS decides the exact time; 15 minutes is the minimum it allows.
    await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
  }
  return true;
}

/** While the app is open: sync the moment the phone comes back online. */
export function watchConnectivity() {
  let wasOnline: boolean | null = null;
  return NetInfo.addEventListener((s) => {
    const online = !!s.isConnected && s.isInternetReachable !== false;
    if (online && wasOnline === false) runSync().catch(() => {});
    wasOnline = online;
  });
}
