import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import NetInfo from '@react-native-community/netinfo';
import { FromAetherLink, LogoMark } from '../components/Brand';
import { Button } from '../components/ui';
import { getSetting, setSetting, useLive } from '../lib/db';
import { calendarPermission } from '../lib/calendar';
import { scheduleDailyBriefNotification, scheduleMeetingReminders, setupNotifications } from '../lib/notifications';
import { MODELS, activeModel, downloadModel, formatBytes, importModelFromDevice, onDownload, type DownloadState } from '../lib/ai/models';
import { colors } from '../theme';

const DEFAULT_MODEL = MODELS[0];

/** First-launch setup: name, all permissions in one go, AI model, optional app lock. */
export default function Welcome() {
  const [name, setName] = useState(getSetting('user.name', ''));
  const [perms, setPerms] = useState<{ calendar: boolean; notifications: boolean } | null>(null);
  const [lock, setLock] = useState(false);
  const [dl, setDl] = useState<DownloadState | null>(null);
  const [error, setError] = useState('');
  const model = useLive(['model', 'settings'], () => activeModel());

  useEffect(() => onDownload(setDl), []);
  useEffect(() => {
    (async () => {
      const calendar = await calendarPermission(false);
      const notifications = await setupNotifications(false);
      if (calendar || notifications) setPerms({ calendar, notifications });
    })();
  }, []);

  async function allowAll() {
    const calendar = await calendarPermission(true);
    const notifications = await setupNotifications(true);
    setPerms({ calendar, notifications });
    if (notifications) {
      await scheduleMeetingReminders().catch(() => {});
      await scheduleDailyBriefNotification().catch(() => {});
    }
    if (!calendar || !notifications) {
      Alert.alert('Some access was not allowed', 'You can allow it later in the phone Settings → Apps → Shotor AI → Permissions.');
    }
  }

  async function startDownload() {
    setError('');
    const s = await NetInfo.fetch();
    const go = () => downloadModel(DEFAULT_MODEL).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (s.type !== 'wifi' && s.type !== 'ethernet') {
      Alert.alert('Not on Wi-Fi', `The AI model is ${formatBytes(DEFAULT_MODEL.sizeBytes)}. Download on mobile data?`, [
        { text: 'Wait for Wi-Fi', style: 'cancel' },
        { text: 'Download', onPress: go },
      ]);
    } else go();
  }

  async function importFile() {
    setError('');
    try {
      await importModelFromDevice();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleLock(v: boolean) {
    if (!v) return setLock(false);
    const ok = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!ok) return Alert.alert('Not available', 'Set up a fingerprint, face or screen lock on this phone first.');
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on app lock' });
    if (res.success) setLock(true);
  }

  function finish() {
    setSetting('user.name', name.trim());
    setSetting('lock.enabled', lock ? '1' : '0');
    setSetting('onboarding.done', '1');
    router.replace('/');
  }

  const pct = dl ? Math.floor((dl.written / Math.max(1, dl.total)) * 100) : 0;
  const permsDone = !!perms?.calendar && !!perms?.notifications;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <LogoMark size={84} color={colors.white} letterColor={colors.navyDeep} />
          <Text style={styles.title}>Welcome to Shotor AI</Text>
          <Text style={styles.subtitle}>Your private assistant. It runs on this phone. Your reports, mail and chats never leave it.</Text>
        </View>

        <Step n={1} title="Your name" done={!!name.trim()}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Sarah Khan"
            placeholderTextColor="rgba(255,255,255,0.45)"
            autoCapitalize="words"
          />
          <Text style={styles.note}>Used in greetings and to sign email drafts.</Text>
        </Step>

        <Step n={2} title="Allow access" done={permsDone}>
          <Text style={styles.note}>📅 Calendar: to show today’s meetings{'\n'}🔔 Notifications: reminders before each meeting and your daily brief</Text>
          {permsDone ? (
            <Text style={styles.ok}>✓ Calendar and notifications allowed</Text>
          ) : (
            <Button title={perms ? 'Allow remaining access' : 'Allow access'} variant="secondary" onPress={allowAll} />
          )}
          {perms && !permsDone ? (
            <Text style={styles.warn}>
              {!perms.calendar ? 'Calendar not allowed. ' : ''}
              {!perms.notifications ? 'Notifications not allowed.' : ''}
            </Text>
          ) : null}
        </Step>

        <Step n={3} title="Offline AI model" done={!!model}>
          {model ? (
            <Text style={styles.ok}>✓ {model.info.name} is ready</Text>
          ) : dl && dl.status !== 'error' ? (
            <>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${pct}%` }]} />
              </View>
              <Text style={styles.note}>
                Downloading {pct}% · {formatBytes(dl.written)} of {formatBytes(dl.total)}. You can continue, and it keeps downloading while the app is open.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.note}>
                Download once ({formatBytes(DEFAULT_MODEL.sizeBytes)}, use Wi-Fi). After that, summaries, chat and email drafts work without internet.
              </Text>
              <Button title="Download AI model" variant="secondary" onPress={startDownload} />
              <Button title="I have the model file" variant="ghost" onPress={importFile} style={{ paddingVertical: 6 }} />
            </>
          )}
          {error || dl?.error ? <Text style={styles.warn}>{error || dl?.error}</Text> : null}
        </Step>

        <Step n={4} title="App lock (recommended)" done={lock}>
          <View style={styles.row}>
            <Text style={[styles.note, { flex: 1 }]}>Ask for Face ID / fingerprint when opening Shotor.</Text>
            <Switch value={lock} onValueChange={toggleLock} trackColor={{ true: '#5B8DEF', false: 'rgba(255,255,255,0.25)' }} />
          </View>
        </Step>

        <Button title="Start using Shotor" onPress={finish} variant="secondary" style={{ marginTop: 8 }} />
        <Text style={[styles.note, { textAlign: 'center' }]}>Gmail can be connected later from the Mail tab.</Text>
        <FromAetherLink light />
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.row}>
        <View style={[styles.badge, done && styles.badgeDone]}>
          <Text style={[styles.badgeText, done && { color: colors.navy }]}>{done ? '✓' : n}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  content: { padding: 20, gap: 14, paddingBottom: 30 },
  hero: { alignItems: 'center', gap: 10, paddingVertical: 18 },
  title: { color: colors.white, fontSize: 26, fontWeight: '700', marginTop: 6 },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 15, textAlign: 'center', lineHeight: 21 },
  step: { backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  badgeDone: { backgroundColor: colors.white, borderColor: colors.white },
  badgeText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  stepTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  note: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 20 },
  ok: { color: '#86EFAC', fontSize: 14, fontWeight: '600' },
  warn: { color: '#FCD34D', fontSize: 13 },
  input: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, fontSize: 16, color: colors.white },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.white },
});
