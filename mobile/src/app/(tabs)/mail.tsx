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
import { NEEDS_ANSWER_SQL, clearMailSummary, dismissEmail, mailSettings } from '../../lib/mail/agent';
import { REASON_LABEL } from '../../lib/mail/rules';
import { parseReasons } from '../../components/EmailExtras';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { mailAccount } from '../../lib/mail/account';
import { imapSupported } from '../../lib/mail/imap';
import { parseOptions } from '../../lib/mail/rules';
import { colors, type } from '../../theme';

export default function Mail() {
  const account = useLive(['emails', 'settings'], () => mailAccount());
  const lastSync = useLive(['emails', 'settings'], () => Number(getSetting('mail.lastSync', '0')));
  const emails = useLive(['emails'], () => db.getAllSync<Email>('SELECT * FROM emails ORDER BY date DESC LIMIT 100'));
  const outbox = useLive(['outbox'], () =>
    db.getAllSync<OutboxRow>(`SELECT * FROM outbox WHERE status != 'sent' OR sent_at > ? ORDER BY created_at DESC LIMIT 30`, Date.now() - 2 * 86400000),
  );
  const needsAnswer = useLive(['emails', 'outbox'], () => db.getAllSync<Email>(NEEDS_ANSWER_SQL));
  const assistant = useLive(['settings'], () => mailSettings());
  const [online, setOnline] = useState(true);
  // Re-render every 30 s so "sending in N min" counts down.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)), []);
  // Opening Mail clears the "N emails waiting" notification.
  useFocusEffect(useCallback(() => clearMailSummary(), []));

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
            <Text style={type.h2}>Connect your email</Text>
          </Row>
          <Text style={type.body}>
            Read your recent email offline. Shotor sorts new mail, summarises it and suggests answers; if you allow it in Settings, it also answers routine mail by itself. Replies wait in the Outbox when you are offline.
          </Text>
          {isGmailConfigured() ? (
            <Button title="Connect Gmail / Google" onPress={connect} disabled={!online} />
          ) : (
            <Text style={[type.small, { color: colors.warn }]}>Gmail is not enabled in this build. Ask your administrator to add the Google client ID.</Text>
          )}
          {imapSupported() ? (
            <Button title="Connect work email (Hostinger, company mail)" variant="secondary" onPress={() => router.push('/mail/connect')} disabled={!online} />
          ) : null}
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

      <Pressable onPress={() => router.push('/settings')}>
        <Text style={type.small}>
          Auto-reply to routine email: <Text style={{ fontWeight: '700', color: assistant.autoReply ? colors.success : colors.muted }}>{assistant.autoReply ? 'ON' : 'OFF'}</Text>
          <Text style={{ color: colors.navySoft }}>  · change in Settings</Text>
        </Text>
      </Pressable>

      {needsAnswer.length ? (
        <>
          <SectionTitle>Waiting for you ({needsAnswer.length})</SectionTitle>
          {needsAnswer.map((e) => (
            <Card key={e.id} style={{ borderLeftWidth: 4, borderLeftColor: e.category === 'important' ? colors.danger : colors.accent }}>
              <Pressable onPress={() => router.push(`/mail/${e.id}`)}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={[styles.from, { color: colors.ink, fontWeight: '700' }]} numberOfLines={1}>{e.from_name || e.from_addr}</Text>
                  <Text style={type.tiny}>{formatDate(e.date)}</Text>
                </Row>
                <Text style={type.h3} numberOfLines={1}>{e.subject}</Text>
                <Text style={[type.body, { fontSize: 14 }]}>{e.ai_summary || e.snippet}</Text>
                {parseReasons(e.reasons).length ? (
                  <Text style={[type.tiny, { color: colors.navy, fontWeight: '600' }]}>{parseReasons(e.reasons).map((r) => REASON_LABEL[r]).join('  ·  ')}</Text>
                ) : null}
              </Pressable>
              <Text style={type.tiny}>What should I answer?</Text>
              <View style={styles.choices}>
                {parseOptions(e.options).map((o) => (
                  <Pressable key={o} style={styles.choice} onPress={() => router.push({ pathname: '/mail/[id]', params: { id: e.id, choice: o } })}>
                    <Text style={styles.choiceText}>{o}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.choice} onPress={() => router.push(`/mail/${e.id}`)}>
                  <Text style={styles.choiceText}>Write my own…</Text>
                </Pressable>
                <Pressable style={[styles.choice, styles.choiceGhost]} onPress={() => dismissEmail(e.id)}>
                  <Text style={[styles.choiceText, { color: colors.muted }]}>No answer needed</Text>
                </Pressable>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {outbox.some((o) => o.auto) ? (
        <>
          <SectionTitle>Answered by Shotor</SectionTitle>
          {outbox.filter((o) => o.auto).map((o) => (
            <Card key={o.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{o.subject}</Text>
                <Pill
                  label={
                    o.status === 'queued' && o.send_after && o.send_after > Date.now()
                      ? `AUTO-REPLY IN ${Math.max(1, Math.ceil((o.send_after - Date.now()) / 60000))} MIN`
                      : { queued: online ? 'SENDING SOON' : 'WAITING FOR INTERNET', sending: 'SENDING', sent: o.auto ? 'AUTO-REPLIED' : 'SENT', failed: 'FAILED', draft: 'DRAFT' }[o.status]
                  }
                  tone={o.status === 'sent' ? 'success' : o.status === 'failed' ? 'danger' : o.auto ? 'navy' : 'warn'}
                />
              </Row>
              <Text style={type.small} numberOfLines={1}>To: {o.to_addr}</Text>
              {o.auto ? <Text style={type.small} numberOfLines={3}>{o.body}</Text> : null}
              {o.status === 'failed' && o.error ? <Text style={[type.small, { color: colors.danger }]} numberOfLines={3}>{o.error}</Text> : null}
              {o.status === 'failed' || o.status === 'queued' ? (
                <Row>
                  {o.status === 'failed' ? <Button small variant="secondary" title="Retry" onPress={() => retryOutbox(o.id)} /> : null}
                  <Button small variant="ghost" title={o.auto ? 'Cancel auto-reply' : 'Cancel'} onPress={() => deleteOutbox(o.id)} />
                </Row>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {outbox.some((o) => !o.auto) ? (
        <>
          <SectionTitle>Outbox {pending.filter((o) => !o.auto).length ? `(${pending.filter((o) => !o.auto).length})` : ''}</SectionTitle>
          {outbox.filter((o) => !o.auto).map((o) => (
            <Card key={o.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={[type.h3, { flex: 1 }]} numberOfLines={1}>{o.subject}</Text>
                <Pill
                  label={
                    o.status === 'queued' && o.send_after && o.send_after > Date.now()
                      ? `AUTO-REPLY IN ${Math.max(1, Math.ceil((o.send_after - Date.now()) / 60000))} MIN`
                      : { queued: online ? 'SENDING SOON' : 'WAITING FOR INTERNET', sending: 'SENDING', sent: o.auto ? 'AUTO-REPLIED' : 'SENT', failed: 'FAILED', draft: 'DRAFT' }[o.status]
                  }
                  tone={o.status === 'sent' ? 'success' : o.status === 'failed' ? 'danger' : o.auto ? 'navy' : 'warn'}
                />
              </Row>
              <Text style={type.small} numberOfLines={1}>To: {o.to_addr}</Text>
              {o.auto ? <Text style={type.small} numberOfLines={3}>{o.body}</Text> : null}
              {o.status === 'failed' && o.error ? <Text style={[type.small, { color: colors.danger }]} numberOfLines={3}>{o.error}</Text> : null}
              {o.status === 'failed' || o.status === 'queued' ? (
                <Row>
                  {o.status === 'failed' ? <Button small variant="secondary" title="Retry" onPress={() => retryOutbox(o.id)} /> : null}
                  <Button small variant="ghost" title={o.auto ? 'Cancel auto-reply' : 'Cancel'} onPress={() => deleteOutbox(o.id)} />
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
              <Text style={[type.small, { flex: 1 }]} numberOfLines={2}>{e.ai_summary || e.snippet}</Text>
              {e.replied ? (
                <Pill label={e.handled === 'auto_replied' ? 'AUTO-REPLIED' : 'REPLIED'} tone="success" />
              ) : e.handled === 'auto_replied' ? (
                <Pill label="AUTO-REPLY QUEUED" tone="navy" />
              ) : e.category === 'important' ? (
                <Pill label="IMPORTANT" tone="danger" />
              ) : e.category === 'no_reply' || e.is_bulk ? (
                <Pill label="NO REPLY NEEDED" />
              ) : null}
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
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: '#E3E9F5', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  choiceGhost: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  choiceText: { color: colors.navy, fontSize: 13, fontWeight: '600' },
});
