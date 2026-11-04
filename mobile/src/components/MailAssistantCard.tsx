import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput } from 'react-native';
import { Card, Row } from './ui';
import { getSetting, notify, setSetting, useLive } from '../lib/db';
import { AUTO_REPLIES_PER_DAY, mailSettings, setAutoReply } from '../lib/mail/agent';
import { colors, radius, type } from '../theme';

const DELAYS = [5, 10, 30];

/** Settings: how the email assistant handles new mail. */
export function MailAssistantCard() {
  const s = useLive(['settings'], () => mailSettings());
  const [note, setNote] = useState(getSetting('mail.autoNote', ''));

  function toggle(on: boolean) {
    if (!on) return setAutoReply(false);
    Alert.alert(
      'Answer routine email automatically?',
      `Shotor will reply by itself only to simple mail such as thank-you notes and "received" messages. ` +
        `Anything about money, contracts, decisions, complaints or deadlines is always left for you.\n\n` +
        `Each automatic reply waits ${s.delayMin} minutes in the Outbox so you can cancel it. At most ${AUTO_REPLIES_PER_DAY} per day.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn on', onPress: () => setAutoReply(true) },
      ],
    );
  }

  const set = (key: string, value: string) => {
    setSetting(key, value);
    notify('settings');
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[type.h3, { flex: 1 }]}>Answer routine email automatically</Text>
        <Switch value={s.autoReply} onValueChange={toggle} trackColor={{ true: colors.navy }} />
      </Row>
      <Text style={type.small}>
        {s.autoReply
          ? 'On: Shotor answers simple mail by itself and only asks you about important email.'
          : 'Off: Shotor summarises new email and suggests answers. You choose what to send.'}
      </Text>

      {s.autoReply ? (
        <>
          <Text style={type.small}>Wait before sending (time to cancel)</Text>
          <Row>
            {DELAYS.map((d) => (
              <Pressable key={d} onPress={() => set('mail.autoDelay', String(d))} style={[styles.chip, s.delayMin === d && styles.chipOn]}>
                <Text style={[styles.chipText, s.delayMin === d && { color: colors.white }]}>{d} min</Text>
              </Pressable>
            ))}
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[type.small, { flex: 1 }]}>Say it is an automatic reply</Text>
            <Switch value={s.disclose} onValueChange={(v) => set('mail.disclose', v ? '1' : '0')} trackColor={{ true: colors.navy }} />
          </Row>
          <Text style={type.small}>Note for automatic replies (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            onEndEditing={() => set('mail.autoNote', note.trim())}
            placeholder="e.g. I am travelling until 12 May and will reply after that."
            placeholderTextColor={colors.faint}
            multiline
            maxLength={300}
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chip: { backgroundColor: '#E3E9F5', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: colors.navy },
  chipText: { color: colors.navy, fontWeight: '600', fontSize: 13 },
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.text, minHeight: 60, textAlignVertical: 'top' },
});
