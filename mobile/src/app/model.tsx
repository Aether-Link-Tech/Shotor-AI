import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '../components/ui';
import {
  MODELS,
  activeModel,
  cancelDownload,
  deleteModel,
  downloadModel,
  formatBytes,
  importModelFromDevice,
  isDownloaded,
  partialBytes,
  onDownload,
  pauseDownload,
  resumeDownload,
  setActiveModel,
  type DownloadState,
} from '../lib/ai/models';
import { unloadModel } from '../lib/ai/engine';
import { useLive } from '../lib/db';
import { colors, type } from '../theme';

export default function ModelScreen() {
  const active = useLive(['model', 'settings'], () => activeModel());
  const downloaded = useLive(['model'], () => Object.fromEntries(MODELS.map((m) => [m.id, isDownloaded(m)])));
  const [dl, setDl] = useState<DownloadState | null>(null);
  const [wifi, setWifi] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => onDownload(setDl), []);
  useEffect(() => NetInfo.addEventListener((s) => setWifi(s.type === 'wifi' || s.type === 'ethernet')), []);

  async function start(id: string) {
    const m = MODELS.find((x) => x.id === id)!;
    const go = () => {
      setError('');
      downloadModel(m).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    };
    if (!wifi) {
      Alert.alert('Not on Wi-Fi', `This download is ${formatBytes(m.sizeBytes)}. Continue on mobile data?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download', onPress: go },
      ]);
    } else go();
  }

  async function use(id: string) {
    await unloadModel();
    setActiveModel(id);
  }

  async function importFile() {
    setError('');
    try {
      await unloadModel();
      const name = await importModelFromDevice();
      if (name) Alert.alert('Model imported', `${name} is now the active model.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Screen>
      <Text style={type.body}>
        The AI runs entirely on this phone. Download a model once over Wi-Fi; after that everything works offline. Bigger models write better but need more memory.
      </Text>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      {MODELS.filter((m) => !m.hidden || downloaded[m.id]).map((m) => {
        const isActive = active?.info.id === m.id;
        const has = downloaded[m.id];
        const mine = dl?.modelId === m.id ? dl : null;
        const pct = mine ? Math.floor((mine.written / Math.max(1, mine.total)) * 100) : 0;
        return (
          <Card key={m.id} style={isActive ? { borderColor: colors.navy, borderWidth: 1.5 } : undefined}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[type.h3, { flex: 1 }]}>{m.name}</Text>
              {isActive ? <Pill label="IN USE" tone="success" /> : has ? <Pill label="DOWNLOADED" tone="navy" /> : null}
            </Row>
            <Text style={type.small}>{m.description}</Text>
            <Text style={type.tiny}>
              {formatBytes(m.sizeBytes)} · needs about {m.ramGb} GB RAM
            </Text>
            {mine ? (
              <>
                <View style={styles.bar}>
                  <View style={[styles.fill, { width: `${pct}%` }]} />
                </View>
                <Text style={type.small}>
                  {mine.status === 'waiting'
                    ? `${pct}% · waiting for internet — it continues by itself`
                    : `${pct}% · ${formatBytes(mine.written)} of ${formatBytes(mine.total)}${mine.status === 'paused' ? ' · paused (saved)' : ''}`}
                </Text>
                <Row>
                  {mine.status === 'downloading' || mine.status === 'waiting' ? <Button small variant="secondary" title="Pause" onPress={pauseDownload} /> : null}
                  {mine.status === 'paused' ? <Button small variant="secondary" title="Resume" onPress={resumeDownload} /> : null}
                  <Button small variant="ghost" title="Cancel" onPress={cancelDownload} />
                </Row>
              </>
            ) : has ? (
              <Row>
                {!isActive ? <Button small title="Use this model" onPress={() => use(m.id)} /> : null}
                <Button
                  small
                  variant="danger"
                  title="Delete"
                  onPress={() =>
                    Alert.alert('Delete model?', `Frees ${formatBytes(m.sizeBytes)}.`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: async () => { if (isActive) await unloadModel(); deleteModel(m); } },
                    ])
                  }
                />
              </Row>
            ) : (
              <Button
                small
                variant="secondary"
                title={partialBytes(m) > 0 ? `Continue download (${formatBytes(partialBytes(m))} saved)` : 'Download'}
                onPress={() => start(m.id)}
                disabled={!!dl && dl.status !== 'paused'}
              />
            )}
          </Card>
        );
      })}

      <SectionTitle>Install without internet</SectionTitle>
      <Card>
        <Text style={type.small}>
          Already have a .gguf model file on this phone (copied by USB, AirDrop or Files)? Import it here — no download needed.
        </Text>
        <Button small variant="secondary" title="Import .gguf file" onPress={importFile} />
        {active?.info.id === 'custom' ? <Text style={type.tiny}>In use: {active.info.name}</Text> : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, backgroundColor: '#E3E9F5', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.navy },
});
