import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { engineStatus, onEngineStatus, type EngineStatus } from '../lib/ai/engine';
import { activeModel } from '../lib/ai/models';
import { useLive } from '../lib/db';
import { Button, Card } from './ui';
import { colors } from '../theme';

export function useEngine() {
  const [status, setStatus] = useState<EngineStatus>(engineStatus().status);
  useEffect(() => onEngineStatus(setStatus), []);
  const model = useLive(['model', 'settings'], () => activeModel());
  return { status, model };
}

/** Shown when no model is installed yet, or while the model is loading into memory. */
export function ModelBanner() {
  const { status, model } = useEngine();
  if (!model) {
    return (
      <Card style={styles.setup}>
        <Text style={styles.setupTitle}>Set up the offline AI</Text>
        <Text style={styles.setupBody}>
          Download the AI model once (about 2 GB, use Wi-Fi). After that, summaries, chat and email drafts work without internet.
        </Text>
        <Button title="Choose AI model" onPress={() => router.push('/model')} variant="secondary" />
      </Card>
    );
  }
  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading {model.info.name} into memory… the first answer takes a few seconds.</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  setup: { backgroundColor: colors.navy, borderColor: colors.navy },
  setupTitle: { color: colors.white, fontSize: 17, fontWeight: '700' },
  setupBody: { color: 'rgba(255,255,255,0.8)', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  loading: { backgroundColor: '#E3E9F5', padding: 10, borderRadius: 10 },
  loadingText: { color: colors.navy, fontSize: 13 },
});
