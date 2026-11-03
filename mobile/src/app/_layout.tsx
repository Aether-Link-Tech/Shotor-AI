import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { getSetting, migrate } from '../lib/db';
import { setupNotifications, scheduleDailyBriefNotification } from '../lib/notifications';
import { registerBackgroundSync, runSync, watchConnectivity } from '../lib/sync';
import { runQueue } from '../lib/jobs';
import { onDownload, resumeInterruptedDownload } from '../lib/ai/models';
import { autoTune } from '../lib/ai/engine';
import { PdfHost } from '../components/PdfHost';
import { FromAetherLink, LogoMark } from '../components/Brand';
import { Button } from '../components/ui';
import { colors } from '../theme';

migrate();
SplashScreen.preventAutoHideAsync().catch(() => {});

const RELOCK_AFTER_MS = 60_000;

export default function RootLayout() {
  const lockEnabled = getSetting('lock.enabled', '0') === '1';
  const [locked, setLocked] = useState(lockEnabled);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
    (async () => {
      await setupNotifications(false).catch(() => {});
      await scheduleDailyBriefNotification().catch(() => {});
      await registerBackgroundSync().catch(() => {});
      runSync().catch(() => {});
      // Continue any report summaries that were interrupted when the app was closed.
      runQueue().catch(() => {});
      // Continue a model download that was interrupted (connection lost, app closed, phone restarted).
      resumeInterruptedDownload();
      // Tune the AI for this phone once per model (picks the fastest cores / graphics chip setting).
      autoTune();
    })();
    // …and again right after a new model finishes downloading.
    const offDl = onDownload((d) => {
      if (!d) autoTune();
    });
    const offNet = watchConnectivity();
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgroundedAt.current = Date.now();
      if (s === 'active') {
        if (getSetting('lock.enabled', '0') === '1' && backgroundedAt.current && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) setLocked(true);
        backgroundedAt.current = null;
        runSync().catch(() => {});
      }
    });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as { kind?: string; url?: string } | undefined;
      if (data?.kind === 'brief') router.navigate('/');
      else if ((data?.kind === 'meeting' || data?.kind === 'report') && data.url) router.push(data.url as never);
    });
    return () => {
      offNet();
      offDl();
      appState.remove();
      tap.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
      <StatusBar style={locked ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerTintColor: colors.navy,
          headerTitleStyle: { color: colors.ink, fontWeight: '700' },
          headerStyle: { backgroundColor: colors.white },
          headerTransparent: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="report/new" options={{ title: 'New report' }} />
        <Stack.Screen name="report/[id]" options={{ title: 'Report' }} />
        <Stack.Screen name="mail/[id]" options={{ title: 'Email' }} />
        <Stack.Screen name="meeting/[id]" options={{ title: 'Meeting' }} />
        <Stack.Screen name="model" options={{ title: 'AI model' }} />
        <Stack.Screen name="welcome" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
      <PdfHost />
      {locked ? <LockScreen onUnlock={() => setLocked(false)} /> : null}
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [error, setError] = useState('');
  const unlock = async () => {
    setError('');
    const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Shotor AI', disableDeviceFallback: false });
    if (res.success) onUnlock();
    else if (res.error !== 'user_cancel' && res.error !== 'system_cancel') setError('Could not verify. Try again.');
  };
  useEffect(() => {
    unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.lock}>
      <View style={styles.lockCenter}>
        <LogoMark size={96} color={colors.white} letterColor={colors.navyDeep} />
        <Text style={styles.lockTitle}>Shotor AI</Text>
        <Text style={styles.lockSub}>Private. On this phone only.</Text>
        <Button title="Unlock" onPress={unlock} variant="secondary" style={{ marginTop: 28, minWidth: 180 }} />
        {error ? <Text style={styles.lockError}>{error}</Text> : null}
      </View>
      <FromAetherLink light />
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.navy, justifyContent: 'space-between', paddingBottom: 36 },
  lockCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  lockTitle: { color: colors.white, fontSize: 28, fontWeight: '700', marginTop: 16 },
  lockSub: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  lockError: { color: '#FCA5A5', marginTop: 12 },
});
