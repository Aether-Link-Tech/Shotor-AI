import { useState } from 'react';
import { Text } from 'react-native';
import { Button, Card, Row } from './ui';
import { Markdown } from './Markdown';
import { SparkIcon } from './Icons';
import { useEngine } from './ModelBanner';
import { prepareMeeting, savedMeetingPrep } from '../lib/assistant';
import { stopGenerating } from '../lib/ai/engine';
import { colors, type } from '../theme';

type Props = { meetingId: string; title: string; start: Date; end: Date; location: string; notes: string };

/** "Prepare me": a short AI note for the meeting, built from related reports and emails on the phone. */
export function MeetingPrepCard(props: Props) {
  const { model } = useEngine();
  const saved = savedMeetingPrep(props.meetingId);
  const [text, setText] = useState(saved?.text ?? '');
  const [at, setAt] = useState(saved?.at ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setError('');
    setBusy(true);
    setText('');
    try {
      const out = await prepareMeeting(props.meetingId, props, setText);
      setText(out);
      setAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.accent }}>
      <Row>
        <SparkIcon color={colors.navy} />
        <Text style={[type.h3, { flex: 1 }]}>Prepare me</Text>
      </Row>
      {text ? (
        <Markdown text={text} />
      ) : (
        <Text style={type.small}>A short note for this meeting: what you should know from your reports and emails, what to decide, and what to do first.</Text>
      )}
      {at && !busy ? <Text style={type.tiny}>Prepared {new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text> : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {busy ? (
        <Button small variant="ghost" title="Stop" onPress={() => stopGenerating()} />
      ) : (
        <Button small variant="secondary" title={text ? 'Prepare again' : 'Prepare me'} onPress={run} disabled={!model || !props.title.trim()} />
      )}
    </Card>
  );
}
