import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { Button, Card, Empty, Pill, Row, SectionTitle } from '../../components/ui';
import { CloudOffIcon, MailIcon } from '../../components/Icons';
import { Watermark } from '../../components/Brand';
import { db, getSetting, useLive } from '../../lib/db';
import { connectGmail, isGmailConfigured } from '../../lib/gmail/auth';
import { deleteOutbox, flushOutbox, retryOutbox, syncInbox, type OutboxRow } from '../../lib/gmail/gmail';
import type { Email } from '../../lib/assistant';
import { colors, type } from '../../theme';

export default function Mail() {
  const account = useLive(['emails', 'settings'], () => getSetting('google.email'));
  const lastSync = useLive(['emails', 'settings'], () => Number(getSetting('mail.lastSync', '0')));
  const emails = useLive(['emails'], () => db.getAllSync<Email>('SELECT * FROM emails ORDER BY date DESC LIMIT 100'));
  const outbox = useLive(['outbox'], () =>
    db.getAllSync<OutboxRow>(`SELECT * FROM outbox WHERE status != 'sent' OR sent_at > ? ORDER BY created_at DESC LIMIT 30`, Date.now() - 2 * 86400000),
  );
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)), []);

  async function sync() {
    setSyncing(true);
    setError('');
    try {
      await flushOutbox();
      await syncInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function connect() {
    setError('');
    try {
      await connectGmail();
      await sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!account) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, gap: 12 }}>
        <Watermark />
        <Card>
          <Row>
            <MailIcon color={colors.navy} />
            <Text style={type.h2}>Connect Gmail</Text>
          </Row>
          <Text style={type.body}>
            Read your recent email offline and let the AI draft replies. You approve every reply; if you are offline, it waits in the Outbox and sends automatically when you are back online.
          </Text>
          {isGmailConfigured() ? (
            <Button title="Connect Gmail" onPress={connect} disabled={!online} />
          ) : (
            <Text style={[type.small, { color: colors.warn }]}>Gmail is not enabled in this build. Ask your administrator to add the Google client ID.</Text>
          )}
          {!online ? <Text style={type.small}>Connecting needs internet once.</Text> : null}
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        </Card>
      </View>
    );
  }

  const pending = outbox.filter((o) => o.status !== 'sent');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={syncing} onRefresh={sync} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={type.small} numberOfLines={1}>{account}</Text>
          <Text style={type.tiny}>{lastSync ? `Updated ${new Date(lastSync).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Not synced yet'}</Text>
        </View>
        {online ? <Button small variant="secondary" title="Sync" onPress={sync} loading={syncing} /> : <Row><CloudOffIcon color={colors.warn} /><Text style={{ color: colors.warn, fontSize: 13 }}>Offline</Text></Row>}
      </Row>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      {outbox.length ? (
        <>
          <SectionTitle>Outbox {pending.length ? `(${pending.length})` : ''}</SectionTitle>
          {outbox.map((o) => (
            <Card key={o.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{o.subject}</Text>
                <Pill
                  label={{ queued: online ? 'SENDING SOON' : 'WAITING FOR INTERNET', sending: 'SENDING', sent: 'SENT', failed: 'FAILED', draft: 'DRAFT' }[o.status]}
                  tone={o.status === 'sent' ? 'success' : o.status === 'failed' ? 'danger' : 'warn'}
                />
              </Row>
              <Text style={type.small} numberOfLines={1}>To: {o.to_addr}</Text>
              {o.status === 'failed' && o.error ? <Text style={[type.small, { color: colors.danger }]} numberOfLines={3}>{o.error}</Text> : null}
              {o.status === 'failed' || o.status === 'queued' ? (
                <Row>
                  {o.status === 'failed' ? <Button small variant="secondary" title="Retry" onPress={() => retryOutbox(o.id)} /> : null}
                  <Button small variant="ghost" title="Cancel" onPress={() => deleteOutbox(o.id)} />
                </Row>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      <SectionTitle>Inbox · last 7 days</SectionTitle>
      {emails.length === 0 ? (
        <Empty title="No email yet" body={online ? 'Pull down to sync.' : 'Connect to the internet to download your inbox.'} />
      ) : (
        emails.map((e) => (
          <Pressable key={e.id} onPress={() => router.push(`/mail/${e.id}`)} style={({ pressed }) => [styles.mail, pressed && { opacity: 0.8 }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[styles.from, e.unread ? { fontWeight: '700', color: colors.ink } : null]} numberOfLines={1}>
                {e.unread ? '● ' : ''}
                {e.from_name}
              </Text>
              <Text style={type.tiny}>{formatDate(e.date)}</Text>
            </Row>
            <Text style={[type.h3, !e.unread && { fontWeight: '500' }]} numberOfLines={1}>{e.subject}</Text>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={[type.small, { flex: 1 }]} numberOfLines={2}>{e.snippet}</Text>
              {e.replied ? <Pill label="REPLIED" tone="success" /> : null}
            </Row>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function formatDate(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  mail: { backgroundColor: colors.card, borderRadius: 14, padding: 12, gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  from: { flex: 1, fontSize: 14, color: colors.muted },
});
