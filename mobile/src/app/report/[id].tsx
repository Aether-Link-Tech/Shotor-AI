import { useEffect, useState } from 'react';
import { Alert, Share, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button, Card, Empty, Pill, Row, Screen, SectionTitle } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { useEngine } from '../../components/ModelBanner';
import { db, notify, useLive } from '../../lib/db';
import type { Report } from '../../lib/assistant';
import { cancelReport, onPartial, partialSummary, resummarize as queueSummary, type ReportStatus } from '../../lib/jobs';
import { colors, type } from '../../theme';

export default function ReportDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { model } = useEngine();
  const report = useLive(['reports'], () =>
    db.getFirstSync<Report & { status: ReportStatus; progress: string | null; error: string | null }>('SELECT * FROM reports WHERE id = ?', Number(id)),
  );
  const [showOriginal, setShowOriginal] = useState(false);
  const [partial, setPartial] = useState(partialSummary(Number(id)));
  useEffect(() => onPartial(() => setPartial(partialSummary(Number(id)))), [id]);

  if (!report) return <Empty title="Report not found" />;
  const busy = report.status === 'queued' || report.status === 'running';
  const error = report.status === 'error' ? report.error : null;

  function remove() {
    Alert.alert('Delete report?', 'The report and its summary will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          db.runSync('DELETE FROM reports WHERE id = ?', report!.id);
          notify('reports');
          router.back();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: report.title }} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={type.small}>{new Date(report.created_at).toLocaleString()}</Text>
        <Pill label={report.source.toUpperCase()} tone="navy" />
      </Row>
      <Text style={type.title}>{report.title}</Text>

      <SectionTitle>Summary</SectionTitle>
      <Card>
        {busy ? (
          <>
            <Text style={type.small}>{report.status === 'queued' ? 'Waiting for the previous report to finish…' : report.progress || 'Working…'}</Text>
            {partial ? <Markdown text={partial} /> : null}
            <Text style={type.tiny}>You can leave this screen — you’ll get a notification when it’s ready.</Text>
            {report.status === 'queued' ? <Button small variant="ghost" title="Cancel" onPress={() => cancelReport(report.id)} /> : null}
          </>
        ) : report.summary ? (
          <Markdown text={report.summary} />
        ) : (
          <Text style={type.small}>Not summarized yet.</Text>
        )}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      </Card>

      <Row style={{ flexWrap: 'wrap' }}>
        {report.summary ? (
          <Button small variant="secondary" title="Share summary" onPress={() => Share.share({ title: report.title, message: `${report.title}\n\n${report.summary!.replace(/\*\*/g, '')}` })} />
        ) : null}
        <Button small variant="secondary" title={report.summary ? 'Summarize again' : 'Summarize'} onPress={() => queueSummary(report.id)} loading={busy} disabled={!model || busy} />
        <Button small variant="secondary" title="Ask about it" onPress={() => router.navigate({ pathname: '/chat', params: { q: `About the report "${report.title}": ` } })} />
      </Row>

      <SectionTitle right={<Button small variant="ghost" title={showOriginal ? 'Hide' : 'Show'} onPress={() => setShowOriginal(!showOriginal)} />}>
        Original text
      </SectionTitle>
      {showOriginal ? (
        <Card>
          <Text style={[type.body, { fontSize: 14 }]} selectable>
            {report.original_text.length > 30000 ? report.original_text.slice(0, 30000) + '\n\n… (shortened for display)' : report.original_text}
          </Text>
        </Card>
      ) : null}

      <Button variant="danger" title="Delete report" onPress={remove} style={{ marginTop: 20 }} />
    </Screen>
  );
}
