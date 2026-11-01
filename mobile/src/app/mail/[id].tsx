import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Empty, Pill, Row, Screen, SectionTitle } from '../../components/ui';
import { useEngine } from '../../components/ModelBanner';
import { SparkIcon } from '../../components/Icons';
import { db, useLive } from '../../lib/db';
import { draftEmailReply } from '../../lib/ai/tasks';
import { isOnline, queueReply } from '../../lib/gmail/gmail';
import type { Email } from '../../lib/assistant';
import { colors, radius, type } from '../../theme';

export default function MailDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { model } = useEngine();
  const email = useLive(['emails'], () => db.getFirstSync<Email>('SELECT * FROM emails WHERE id = ?', id));
  const [instructions, setInstructions] = useState('');
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [showFull, setShowFull] = useState(false);

  if (!email) return <Empty title="Email not found" />;

  async function makeDraft() {
    setError('');
    setDrafting(true);
    try {
      const text = await draftEmailReply({ fromName: email!.from_name, fromAddr: email!.from_addr, subject: email!.subject, body: email!.body }, instructions, setDraft);
      setDraft(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  async function approve() {
    const body = draft.trim();
    if (!body) return;
    const online = await isOnline();
    Alert.alert(
      'Send this reply?',
      `To: ${email!.from_addr}\n\n${online ? 'It will be sent now.' : 'You are offline. It will be sent automatically when the phone is back online.'}`,
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: online ? 'Send' : 'Queue',
          onPress: () => {
            queueReply({
              emailId: email!.id,
              threadId: email!.thread_id,
              to: email!.from_addr,
              subject: /^re:/i.test(email!.subject) ? email!.subject : `Re: ${email!.subject}`,
              body,
              inReplyTo: email!.message_id_header,
              references: email!.references_header,
            });
            router.back();
          },
        },
      ],
    );
  }

  const body = email.body || email.snippet;
  return (
    <Screen>
      <Text style={type.h2}>{email.subject}</Text>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[type.small, { flex: 1 }]} numberOfLines={2}>
          {email.from_name} {'<'}{email.from_addr}{'>'}
        </Text>
        {email.replied ? <Pill label="REPLIED" tone="success" /> : null}
      </Row>
      <Text style={type.tiny}>{new Date(email.date).toLocaleString()}</Text>
      <Card>
        <Text style={[type.body, { fontSize: 14 }]} selectable>
          {showFull || body.length <= 2500 ? body : body.slice(0, 2500) + '…'}
        </Text>
        {body.length > 2500 ? <Button small variant="ghost" title={showFull ? 'Show less' : 'Show all'} onPress={() => setShowFull(!showFull)} /> : null}
      </Card>

      <SectionTitle>Reply</SectionTitle>
      <TextInput
        style={styles.input}
        placeholder="Optional: tell the AI what to say (e.g. “accept, propose Tuesday 10am”)"
        placeholderTextColor={colors.faint}
        value={instructions}
        onChangeText={setInstructions}
        multiline
      />
      <Button title={draft ? 'Draft again' : 'Draft reply with AI'} icon={<SparkIcon color={draft ? colors.navy : colors.white} />} variant={draft ? 'secondary' : 'primary'} onPress={makeDraft} loading={drafting} disabled={!model} />
      {!model ? <Text style={type.small}>Set up the AI model in Settings to draft replies. You can still write one yourself below.</Text> : null}

      <TextInput
        style={[styles.input, styles.draft]}
        placeholder="Your reply…"
        placeholderTextColor={colors.faint}
        value={draft}
        onChangeText={setDraft}
        multiline
        editable={!drafting}
        textAlignVertical="top"
      />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button title="Approve & send" onPress={approve} disabled={!draft.trim() || drafting} />
      <Text style={[type.tiny, { textAlign: 'center' }]}>Nothing is sent without your approval.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.white, borderRadius: radius.md, padding: 12, fontSize: 15, color: colors.text, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  draft: { minHeight: 200 },
});
