import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, Pill, Row, Screen, SectionTitle } from '../../components/ui';
import { Markdown } from '../../components/Markdown';
import { Watermark } from '../../components/Brand';
import { ModelBanner, useEngine } from '../../components/ModelBanner';
import { CalendarIcon, SparkIcon } from '../../components/Icons';
import { db, getSetting, useLive } from '../../lib/db';
import { generateDailyBrief, todaysBrief } from '../../lib/assistant';
import { calendarPermission, formatTime, todaysMeetings, type Meeting } from '../../lib/calendar';
import { scheduleMeetingReminders, setupNotifications } from '../../lib/notifications';
import { colors, type } from '../../theme';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const { model } = useEngine();
  const name = useLive(['settings'], () => getSetting('user.name', '').trim());
  const brief = useLive(['briefs'], todaysBrief);
  const stats = useLive(['emails', 'outbox', 'reports'], () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      unread: db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM emails WHERE unread = 1')?.n ?? 0,
      waiting: db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE status IN ('queued','sending')`)?.n ?? 0,
      failed: db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'failed'`)?.n ?? 0,
      reports: db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?', start.getTime())?.n ?? 0,
    };
  });

  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [calAllowed, setCalAllowed] = useState(true);
  const [writing, setWriting] = useState(false);
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');

  const loadMeetings = useCallback(async () => {
    const ok = await calendarPermission(false);
    setCalAllowed(ok);
    setMeetings(ok ? await todaysMeetings() : []);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadMeetings();
    }, [loadMeetings]),
  );

  useEffect(() => {
    // Auto-write the brief once a day when the app is opened and a model is ready.
    if (model && !brief && !writing && getSetting('brief.auto', '1') === '1') makeBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.info.id]);

  async function makeBrief() {
    setError('');
    setWriting(true);
    setPartial('');
    try {
      await generateDailyBrief(setPartial);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(false);
    }
  }

  async function allowCalendar() {
    if (await calendarPermission(true)) {
      await setupNotifications(true);
      await scheduleMeetingReminders();
    }
    loadMeetings();
  }

  const now = Date.now();
  return (
    <View style={{ flex: 1 }}>
      <Watermark />
      <Screen>
        <View style={{ gap: 2 }}>
          <Text style={type.title}>
            {greeting()}
            {name ? `, ${name}` : ''}
          </Text>
          <Text style={type.small}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        </View>

        <ModelBanner />

        <Row style={{ gap: 10 }}>
          <Stat label="Meetings" value={meetings?.length ?? '–'} onPress={() => {}} />
          <Stat label="Unread" value={stats.unread} onPress={() => router.navigate('/mail')} />
          <Stat label="To send" value={stats.waiting + stats.failed} tone={stats.failed ? 'danger' : undefined} onPress={() => router.navigate('/mail')} />
          <Stat label="Reports" value={stats.reports} onPress={() => router.navigate('/reports')} />
        </Row>

        <SectionTitle
          right={
            brief && !writing ? <Button small variant="ghost" title="Refresh" onPress={makeBrief} disabled={!model} /> : null
          }
        >
          Daily brief
        </SectionTitle>
        <Card>
          {writing ? (
            partial ? (
              <Markdown text={partial} />
            ) : (
              <Text style={type.small}>Writing your brief on this phone…</Text>
            )
          ) : brief ? (
            <>
              <Markdown text={brief.content} />
              <Text style={type.tiny}>Written at {new Date(brief.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · offline</Text>
            </>
          ) : (
            <>
              <Text style={type.body}>A short summary of today's meetings, email and reports.</Text>
              <Button title="Write today's brief" icon={<SparkIcon color={colors.white} />} onPress={makeBrief} disabled={!model} />
            </>
          )}
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        </Card>

        <SectionTitle>Today's meetings</SectionTitle>
        {!calAllowed ? (
          <Card>
            <Text style={type.body}>Allow calendar access to see meetings and get reminders before each one.</Text>
            <Button title="Allow calendar & reminders" variant="secondary" icon={<CalendarIcon color={colors.navy} />} onPress={allowCalendar} />
          </Card>
        ) : meetings && meetings.length === 0 ? (
          <Card>
            <Text style={type.small}>No meetings today.</Text>
          </Card>
        ) : (
          (meetings ?? []).map((m) => {
            const live = m.start.getTime() <= now && m.end.getTime() > now;
            const past = m.end.getTime() <= now;
            return (
              <Card key={m.id + m.start.toISOString()} style={past ? { opacity: 0.55 } : undefined}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={styles.time}>{m.allDay ? 'All day' : `${formatTime(m.start)} – ${formatTime(m.end)}`}</Text>
                  {live ? <Pill label="NOW" tone="success" /> : null}
                </Row>
                <Text style={type.h3}>{m.title}</Text>
                {m.location ? <Text style={type.small}>{m.location}</Text> : null}
              </Card>
            );
          })
        )}
      </Screen>
    </View>
  );
}

function Stat({ label, value, onPress, tone }: { label: string; value: number | string; onPress: () => void; tone?: 'danger' }) {
  return (
    <Pressable onPress={onPress} style={styles.stat}>
      <Text style={[styles.statValue, tone === 'danger' && { color: colors.danger }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.navy },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  time: { fontSize: 13, fontWeight: '600', color: colors.navySoft },
});
