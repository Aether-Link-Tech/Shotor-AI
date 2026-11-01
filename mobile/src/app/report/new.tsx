import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Row, Screen } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { ModelBanner, useEngine } from '../../components/ModelBanner';
import { ReportIcon } from '../../components/Icons';
import { pickAndExtract, type ExtractedDoc } from '../../lib/docs/extract';
import { summarizeReport, suggestTitle } from '../../lib/ai/tasks';
import { db, notify } from '../../lib/db';
import { colors, radius, type } from '../../theme';

export default function NewReport() {
  const { model } = useEngine();
  const [mode, setMode] = useState<'pick' | 'paste'>('pick');
  const [doc, setDoc] = useState<ExtractedDoc | null>(null);
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const text = mode === 'pick' ? doc?.text ?? '' : pasted;

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

  async function summarize() {
    if (text.trim().length < 40) return setError('Add a bit more text to summarize.');
    setError('');
    setBusy(true);
    let id: number | null = null;
    try {
      let finalTitle = title.trim();
      if (!finalTitle) {
        setStatus('Choosing a title…');
        finalTitle = await suggestTitle(text);
        setTitle(finalTitle);
      }
      // Save first so nothing is lost if the phone is interrupted.
      const r = db.runSync(
        'INSERT INTO reports (title, source, original_text, created_at) VALUES (?, ?, ?, ?)',
        finalTitle,
        mode === 'paste' ? 'paste' : doc!.kind,
        text,
        Date.now(),
      );
      id = Number(r.lastInsertRowId);
      notify('reports');
      const summary = await summarizeReport(finalTitle, text, (p) => {
        setStatus(p.total > 1 ? `${p.step} (${Math.min(p.done + 1, p.total)}/${p.total})` : p.step);
        if (p.partial) setPartial(p.partial);
      });
      db.runSync('UPDATE reports SET summary = ? WHERE id = ?', summary, id);
      notify('reports');
      router.replace(`/report/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (id) setError((prev) => prev + ' The report was saved; you can summarize it again from the Reports list.');
    } finally {
      setBusy(false);
      setStatus('');
    }
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
        placeholder="Title (optional — AI will suggest one)"
        placeholderTextColor={colors.faint}
        value={title}
        onChangeText={setTitle}
        editable={!busy}
      />

      <Button title={busy ? status || 'Working…' : 'Summarize'} onPress={summarize} loading={busy} disabled={!model || !text.trim()} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {partial ? (
        <Card>
          <Markdown text={partial} />
        </Card>
      ) : null}
      {busy && !partial ? (
        <View style={{ alignItems: 'center' }}>
          <Text style={type.small}>Long reports are read part by part. Keep the app open.</Text>
        </View>
      ) : null}
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
