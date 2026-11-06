import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Row } from './ui';
import { useLive } from '../lib/db';
import type { Email } from '../lib/assistant';
import { isVip, setVip } from '../lib/mail/agent';
import { REASON_LABEL, isMeetingEmail, parseAttachments, realFiles, type Attachment, type Reason } from '../lib/mail/rules';
import { stripQuoted } from '../lib/mail/redact';
import { findMeetingTime } from '../lib/meetingParse';
import { mailProvider } from '../lib/mail/account';
import { downloadGmailAttachment } from '../lib/gmail/gmail';
import { downloadImapAttachment } from '../lib/mail/imap';
import { extractFile } from '../lib/docs/extract';
import { addReport } from '../lib/jobs';
import { colors, type } from '../theme';

const READABLE = /\.(pdf|docx|pptx|xlsx|txt|csv|md)$/i;

function size(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** On the email page: why it is important, VIP star, attached files (summarised on the phone) and "Add to calendar". */
export function EmailExtras({ email }: { email: Email }) {
  const reasons = parseReasons(email.reasons);
  const vip = useLive(['settings', 'emails'], () => isVip(email.from_addr));
  const files = realFiles(parseAttachments(email.attachments));
  const own = stripQuoted(email.body || email.snippet);
  const meeting = reasons.includes('meeting') || isMeetingEmail(email.subject, own, parseAttachments(email.attachments));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function summarise(a: Attachment) {
    setError('');
    setBusy(a.ref);
    try {
      const uri = mailProvider() === 'imap' ? await downloadImapAttachment(email.id, a) : await downloadGmailAttachment(email.id, a);
      // Read and summarised on the phone: files never go to the online AI.
      const doc = await extractFile({ uri, name: a.name, mimeType: a.mime, size: a.size });
      const id = addReport(doc.name.replace(/\.[^.]+$/, ''), doc.kind, doc.text);
      router.push(`/report/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function addToCalendar() {
    const t = findMeetingTime(own, new Date(email.date));
    const title = email.subject.replace(/^((re|fwd?|aw):\s*)+/i, '').trim() || `Meeting with ${email.from_name}`;
    router.push({
      pathname: '/meeting/[id]',
      params: {
        id: 'new',
        title,
        notes: `From ${email.from_name || email.from_addr}`,
        ...(t ? { start: t.start.toISOString(), end: t.end.toISOString() } : {}),
      },
    });
  }

  return (
    <View style={{ gap: 10 }}>
      <Row style={{ flexWrap: 'wrap' }}>
        {reasons.map((r) => (
          <View key={r} style={styles.badge}>
            <Text style={styles.badgeText}>{REASON_LABEL[r]}</Text>
          </View>
        ))}
        <Pressable onPress={() => setVip(email.from_addr, email.from_name, !vip)} style={[styles.badge, vip ? styles.vipOn : styles.vipOff]}>
          <Text style={[styles.badgeText, vip && { color: colors.white }]}>{vip ? '⭐ Always important' : '☆ Mark sender as always important'}</Text>
        </Pressable>
      </Row>

      {meeting ? <Button small variant="secondary" title="📅 Add to calendar" onPress={addToCalendar} /> : null}

      {files.length ? (
        <Card>
          <Text style={type.h3}>📎 Attached files</Text>
          {files.map((a) => (
            <Row key={a.ref} style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={type.body} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={type.tiny}>{size(a.size)}</Text>
              </View>
              {READABLE.test(a.name) ? (
                <Button small variant="secondary" title={busy === a.ref ? 'Opening…' : 'Summarise file'} onPress={() => summarise(a)} loading={busy === a.ref} disabled={!!busy} />
              ) : null}
            </Row>
          ))}
          <Text style={type.tiny}>Files are read and summarised on this phone; they never go to the online AI.</Text>
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        </Card>
      ) : null}
    </View>
  );
}

export function parseReasons(json: string | null | undefined): Reason[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((r): r is Reason => r in REASON_LABEL) : [];
  } catch {
    return [];
  }
}

const styles = StyleSheet.create({
  badge: { backgroundColor: '#E3E9F5', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: colors.navy, fontSize: 12, fontWeight: '600' },
  vipOn: { backgroundColor: colors.navy },
  vipOff: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
});
