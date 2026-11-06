import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Empty, Pill, Row, Screen, SectionTitle } from '../../components/ui';
import { useEngine } from '../../components/ModelBanner';
import { SparkIcon } from '../../components/Icons';
import { db, useLive } from '../../lib/db';
import { draftEmailReply } from '../../lib/ai/tasks';
import { isOnline, queueReply } from '../../lib/gmail/gmail';
import type { Email } from '../../lib/assistant';
import { dismissEmail } from '../../lib/mail/agent';
import { parseOptions } from '../../lib/mail/rules';
import { EmailExtras } from '../../components/EmailExtras';
import { cloudStatus } from '../../lib/ai/cloud';
import { colors, radius, type } from '../../theme';

export default function MailDetail() {
  // "choice": an answer the owner tapped in the Mail tab; the reply is drafted from it straight away.
  const { id, choice } = useLocalSearchParams<{ id: string; choice?: string }>();
  const { model: phoneModel } = useEngine();
  // Replies can be written by the online AI even before the phone model is downloaded.
  const model = phoneModel || cloudStatus() === 'on';
  const email = useLive(['emails'], () => db.getFirstSync<Email>('SELECT * FROM emails WHERE id = ?', id));
  const [instructions, setInstructions] = useState('');
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [showFull, setShowFull] = useState(false);

  async function makeDraft(what = instructions) {
    if (!email) return;
    setError('');
    setDrafting(true);
    try {
      const text = await draftEmailReply({ fromName: email.from_name, fromAddr: email.from_addr, subject: email.subject, body: email.body || email.snippet }, what, setDraft);
      setDraft(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  const started = useRef(false);
  useEffect(() => {
    if (!choice || started.current || !email || !model) return;
    started.current = true;
    setInstructions(choice);
    makeDraft(choice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, email?.id, model]);

  if (!email) return <Empty title="Email not found" />;
  const options = parseOptions(email.options);

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
      {email.ai_summary ? (
        <Card style={{ backgroundColor: '#E3E9F5' }}>
          <Row>
            <SparkIcon color={colors.navy} />
            <Text style={[type.h3, { flex: 1 }]}>In short</Text>
            {email.category === 'important' ? <Pill label="IMPORTANT" tone="danger" /> : email.category === 'no_reply' ? <Pill label="NO REPLY NEEDED" /> : null}
          </Row>
          <Text style={type.body}>{email.ai_summary}</Text>
        </Card>
      ) : null}
      <EmailExtras email={email} />
      <Card>
        <Text style={[type.body, { fontSize: 14 }]} selectable>
          {showFull || body.length <= 2500 ? body : body.slice(0, 2500) + '…'}
        </Text>
        {body.length > 2500 ? <Button small variant="ghost" title={showFull ? 'Show less' : 'Show all'} onPress={() => setShowFull(!showFull)} /> : null}
      </Card>

      <SectionTitle>Reply</SectionTitle>
      {options.length && !email.replied ? (
        <View style={styles.choices}>
          {options.map((o) => (
            <Pressable
              key={o}
              disabled={drafting || !model}
              style={[styles.choice, instructions === o && styles.choiceActive]}
              onPress={() => {
                setInstructions(o);
                makeDraft(o);
              }}
            >
              <Text style={[styles.choiceText, instructions === o && { color: colors.white }]}>{o}</Text>
            </Pressable>
          ))}
          {email.handled === 'asked' ? (
            <Pressable
              style={[styles.choice, styles.choiceGhost]}
              onPress={() => {
                dismissEmail(email.id);
                router.back();
              }}
            >
              <Text style={[styles.choiceText, { color: colors.muted }]}>No answer needed</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Optional: tell the AI what to say (e.g. “accept, propose Tuesday 10am”)"
        placeholderTextColor={colors.faint}
        value={instructions}
        onChangeText={setInstructions}
        multiline
      />
      <Button title={draft ? 'Draft again' : 'Draft reply with AI'} icon={<SparkIcon color={draft ? colors.navy : colors.white} />} variant={draft ? 'secondary' : 'primary'} onPress={() => makeDraft()} loading={drafting} disabled={!model} />
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
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: '#E3E9F5', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  choiceActive: { backgroundColor: colors.navy },
  choiceGhost: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  choiceText: { color: colors.navy, fontSize: 13, fontWeight: '600' },
});
