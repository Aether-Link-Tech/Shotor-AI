import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import Constants from 'expo-constants';
import { Card, Row, Screen, SectionTitle } from '../../components/ui';
import { FromAetherLink } from '../../components/Brand';
import { useEngine } from '../../components/ModelBanner';
import { db, getSetting, notify, setSetting, useLive } from '../../lib/db';
import { reminderMinutes, setReminderMinutes } from '../../lib/calendar';
import { scheduleDailyBriefNotification, scheduleMeetingReminders, setupNotifications } from '../../lib/notifications';
import { disconnectGmail } from '../../lib/gmail/auth';
import { colors, type } from '../../theme';

const REMINDER_OPTIONS = [5, 10, 15, 30, 60, -1];
const BRIEF_TIMES = ['07:00', '08:00', '09:00', 'off'];

export default function Settings() {
  const { model, status } = useEngine();
  const name = useLive(['settings'], () => getSetting('user.name', ''));
  const lock = useLive(['settings'], () => getSetting('lock.enabled', '0') === '1');
  const reminder = useLive(['settings', 'calendar'], reminderMinutes);
  const briefTime = useLive(['settings'], () => getSetting('brief.time', '08:00'));
  const gmail = useLive(['settings', 'emails'], () => getSetting('google.email'));
  const [nameDraft, setNameDraft] = useState(name);

  async function toggleLock(v: boolean) {
    if (v) {
      const has = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (!has) return Alert.alert('Not available', 'Set up a fingerprint, face or screen lock on this phone first.');
      const ok = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on app lock' });
      if (!ok.success) return;
    }
    setSetting('lock.enabled', v ? '1' : '0');
  }

  async function chooseReminder(m: number) {
    setReminderMinutes(m);
    await setupNotifications(true);
    await scheduleMeetingReminders();
  }

  async function chooseBriefTime(t: string) {
    setSetting('brief.time', t);
    await setupNotifications(true);
    await scheduleDailyBriefNotification();
  }

  function eraseAll() {
    Alert.alert('Erase all data?', 'Deletes reports, chat, cached email, outbox and briefs from this phone. The AI model stays installed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Erase',
        style: 'destructive',
        onPress: async () => {
          await disconnectGmail().catch(() => {});
          db.execSync('DELETE FROM reports; DELETE FROM chat_messages; DELETE FROM emails; DELETE FROM outbox; DELETE FROM briefs;');
          notify('reports', 'chat', 'emails', 'outbox', 'briefs');
        },
      },
    ]);
  }

  return (
    <Screen>
      <SectionTitle>Profile</SectionTitle>
      <Card>
        <Text style={type.small}>Your name (used in greetings and to sign email drafts)</Text>
        <TextInput
          style={styles.input}
          value={nameDraft}
          onChangeText={setNameDraft}
          onEndEditing={() => setSetting('user.name', nameDraft.trim())}
          placeholder="e.g. Sarah Khan"
          placeholderTextColor={colors.faint}
        />
      </Card>

      <SectionTitle>AI</SectionTitle>
      <Pressable onPress={() => router.push('/model')}>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={type.h3}>AI model</Text>
              <Text style={type.small}>{model ? `${model.info.name} · ${status === 'ready' || status === 'busy' ? 'loaded' : 'on device'}` : 'Not installed — tap to set up'}</Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Row>
        </Card>
      </Pressable>

      <SectionTitle>Meeting reminders</SectionTitle>
      <Card>
        <Text style={type.small}>Notify me before each meeting</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {REMINDER_OPTIONS.map((m) => (
            <Choice key={m} label={m < 0 ? 'Off' : m >= 60 ? '1 hour' : `${m} min`} active={reminder === m} onPress={() => chooseReminder(m)} />
          ))}
        </Row>
      </Card>

      <SectionTitle>Daily brief</SectionTitle>
      <Card>
        <Text style={type.small}>Remind me to read my brief at</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {BRIEF_TIMES.map((t) => (
            <Choice key={t} label={t === 'off' ? 'Off' : t} active={briefTime === t} onPress={() => chooseBriefTime(t)} />
          ))}
        </Row>
      </Card>

      <SectionTitle>Email</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{gmail || 'Not connected'}</Text>
          {gmail ? (
            <Text style={styles.link} onPress={() => Alert.alert('Disconnect Gmail?', 'Cached email and the outbox stay on the phone until you erase them.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', style: 'destructive', onPress: () => disconnectGmail() }])}>
              Disconnect
            </Text>
          ) : (
            <Text style={styles.link} onPress={() => router.navigate('/mail')}>Connect</Text>
          )}
        </Row>
      </Card>

      <SectionTitle>Privacy & security</SectionTitle>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>App lock</Text>
            <Text style={type.small}>Face ID / fingerprint when opening the app</Text>
          </View>
          <Switch value={lock} onValueChange={toggleLock} trackColor={{ true: colors.navy, false: colors.line }} />
        </Row>
        <Text style={type.small}>Reports, chat and summaries are stored only on this phone. The AI runs offline. Only Gmail traffic uses the internet.</Text>
        <Text style={[styles.link, { color: colors.danger, marginTop: 6 }]} onPress={eraseAll}>
          Erase all data on this phone
        </Text>
      </Card>

      <View style={{ marginTop: 24, alignItems: 'center' }}>
        <Text style={type.tiny}>Shotor AI · version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        <FromAetherLink />
      </View>
    </Screen>
  );
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]}>
      <Text style={[styles.choiceText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, fontSize: 15, color: colors.text },
  chev: { fontSize: 26, color: colors.faint },
  link: { color: colors.accent, fontWeight: '600', fontSize: 14 },
  choice: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  choiceActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  choiceText: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
