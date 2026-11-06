import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput } from 'react-native';
import { Button, Card, Pill, Row } from './ui';
import { useLive } from '../lib/db';
import { cloudStatus, removeCloudKey, saveCloudKey } from '../lib/ai/cloud';
import { colors, radius, type } from '../theme';

/** Settings: the key for the fast online AI (email and chat). Typed once per phone, stored encrypted. */
export function CloudAiCard() {
  const status = useLive(['settings'], () => cloudStatus());
  const [editing, setEditing] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    setBusy(true);
    try {
      await saveCloudKey(accountId, token);
      setEditing(false);
      setAccountId('');
      setToken('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pill =
    status === 'on' ? (
      <Pill label="ON" tone="success" />
    ) : status === 'limit' ? (
      <Pill label="DAILY LIMIT USED" tone="warn" />
    ) : status === 'invalid' ? (
      <Pill label="KEY NOT VALID" tone="danger" />
    ) : (
      <Pill label="OFF" />
    );

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={[type.h3, { flex: 1 }]}>Online AI (fast email & chat)</Text>
        {pill}
      </Row>
      <Text style={type.small}>
        {status === 'on'
          ? 'Email sorting, summaries, replies and chat use the fast online AI (Cloudflare). Reports, proposals and attachments always stay on this phone.'
          : status === 'limit'
            ? 'Today’s free online allowance is used up. Shotor uses the on-phone AI until it resets (midnight UTC).'
            : status === 'invalid'
              ? 'Cloudflare no longer accepts the saved key. Enter a new one. Until then Shotor uses the on-phone AI.'
              : 'Off: everything runs on this phone (private, but slower). Add a Cloudflare Workers AI key to make email and chat fast.'}
      </Text>

      {editing ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Cloudflare account ID"
            placeholderTextColor={colors.faint}
            value={accountId}
            onChangeText={setAccountId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="Workers AI token"
            placeholderTextColor={colors.faint}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Text style={type.tiny}>The key is checked once, then stored encrypted on this phone only.</Text>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          <Row>
            <Button small title={busy ? 'Checking…' : 'Save'} onPress={save} loading={busy} disabled={!accountId.trim() || !token.trim() || busy} />
            <Button small variant="ghost" title="Cancel" onPress={() => setEditing(false)} />
          </Row>
        </>
      ) : (
        <Row>
          <Button small variant="secondary" title={status === 'off' ? 'Add key' : 'Change key'} onPress={() => setEditing(true)} />
          {status !== 'off' ? (
            <Button
              small
              variant="ghost"
              title="Turn off"
              onPress={() =>
                Alert.alert('Turn off the online AI?', 'The key is removed from this phone and everything runs on the phone again.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Turn off', style: 'destructive', onPress: () => removeCloudKey() },
                ])
              }
            />
          ) : null}
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 12, fontSize: 15, color: colors.text },
});
