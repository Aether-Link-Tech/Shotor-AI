import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Row, Screen } from '../../components/ui';
import { ModelBanner, useEngine } from '../../components/ModelBanner';
import { ReportIcon } from '../../components/Icons';
import { extractFile, pickAndExtract, type ExtractedDoc } from '../../lib/docs/extract';
import { takePendingShare } from '../../lib/share';
import { addReport, titleFor } from '../../lib/jobs';
import { colors, radius, type } from '../../theme';

export default function NewReport() {
  const { model } = useEngine();
  const [mode, setMode] = useState<'pick' | 'paste'>('pick');
  const [doc, setDoc] = useState<ExtractedDoc | null>(null);
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const text = mode === 'pick' ? doc?.text ?? '' : pasted;

  // Opened from Android's Share menu: load the shared file or text.
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  useEffect(() => {
    if (!shared) return;
    const item = takePendingShare();
    if (!item) return;
    if (item.error) return setError(`${item.name ? item.name + ': ' : ''}${item.error}`);
    if (item.text) {
      setMode('paste');
      setPasted(item.text);
      if (item.subject) setTitle(item.subject);
      return;
    }
    if (!item.uri) return;
    setMode('pick');
    setError('');
    setBusy(true);
    extractFile({ uri: item.uri, name: item.name, mimeType: item.mimeType }, setStatus)
      .then((d) => {
        setDoc(d);
        setTitle(d.name.replace(/\.[^.]+$/, ''));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setBusy(false);
        setStatus('');
      });
  }, [shared]);

  async function pick() {
    setError('');
    setBusy(true);
    try {
      const d = await pickAndExtract(setStatus);
      if (d) {
        setDoc(d);
        if (!title) setTitle(d.name.replace(/\.[^.]+$/, ''));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  function summarize() {
    if (text.trim().length < 40) return setError('Add a bit more text to summarize.');
    setError('');
    // Queued as a background job: the user can leave this screen (or the app) while it runs.
    const finalTitle = title.trim() || titleFor(text, mode === 'pick' ? doc?.name : undefined);
    const id = addReport(finalTitle, mode === 'paste' ? 'paste' : doc!.kind, text);
    router.replace(`/report/${id}`);
  }

  return (
    <Screen>
      <ModelBanner />
      <Row style={styles.tabs}>
        {(['pick', 'paste'] as const).map((m) => (
          <Text key={m} onPress={() => !busy && setMode(m)} style={[styles.tab, mode === m && styles.tabActive]}>
            {m === 'pick' ? 'Upload file' : 'Paste text'}
          </Text>
        ))}
      </Row>

      {mode === 'pick' ? (
        <Card>
          {doc ? (
            <>
              <Row>
                <ReportIcon color={colors.navy} />
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={2}>
                  {doc.name}
                </Text>
              </Row>
              <Text style={type.small}>
                {doc.text.length.toLocaleString()} characters read · about {Math.max(1, Math.round(doc.text.split(/\s+/).length / 250))} min of reading
              </Text>
              <Button small variant="ghost" title="Choose a different file" onPress={pick} disabled={busy} />
            </>
          ) : (
            <>
              <Text style={type.body}>PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx) or text files. The file is read on this phone and never uploaded.</Text>
              <Button title="Choose file" variant="secondary" onPress={pick} loading={busy && !doc} />
            </>
          )}
        </Card>
      ) : (
        <TextInput
          style={styles.paste}
          multiline
          placeholder="Paste the report text here…"
          placeholderTextColor={colors.faint}
          value={pasted}
          onChangeText={setPasted}
          editable={!busy}
          textAlignVertical="top"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Title (optional — file name or first line is used)"
        placeholderTextColor={colors.faint}
        value={title}
        onChangeText={setTitle}
        editable={!busy}
      />

      <Button title={busy ? status || 'Reading file…' : 'Summarize'} onPress={summarize} loading={busy} disabled={!model || !text.trim() || busy} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <View style={{ alignItems: 'center' }}>
        <Text style={[type.small, { textAlign: 'center' }]}>The summary is written in the background — you can leave this screen. You’ll get a notification when it’s ready.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { backgroundColor: '#E7EBF2', borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, textAlign: 'center', paddingVertical: 9, borderRadius: 9, color: colors.muted, fontWeight: '600', overflow: 'hidden' },
  tabActive: { backgroundColor: colors.white, color: colors.navy },
  paste: { minHeight: 220, backgroundColor: colors.white, borderRadius: radius.lg, padding: 14, fontSize: 15, color: colors.text, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  input: { backgroundColor: colors.white, borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.text, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
