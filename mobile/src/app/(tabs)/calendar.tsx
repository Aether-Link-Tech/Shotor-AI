import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router, useFocusEffect } from 'expo-router';
import { Button, Card, Empty, Row, SectionTitle } from '../../components/ui';
import { CalendarIcon, PlusIcon, SparkIcon } from '../../components/Icons';
import { useLive } from '../../lib/db';
import { calendarPermission, formatDay, formatTime, getMeetings, sameDay, startOfDay, type Meeting } from '../../lib/calendar';
import { scheduleMeetingReminders, setupNotifications } from '../../lib/notifications';
import { parseMeeting } from '../../lib/meetingParse';
import { colors, radius, type } from '../../theme';

// Week starts on Monday (business calendar).
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function CalendarScreen() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [quick, setQuick] = useState('');
  const [error, setError] = useState('');
  const version = useLive(['calendar'], () => Date.now());

  const days = useMemo(() => monthGrid(month), [month]);

  const load = useCallback(async () => {
    const ok = await calendarPermission(false);
    setAllowed(ok);
    if (!ok) return setMeetings([]);
    setMeetings(await getMeetings(days[0], new Date(days[41].getTime() + 86400000)));
  }, [days]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, version]),
  );

  const countByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of meetings) {
      const k = startOfDay(e.start).toDateString();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [meetings]);

  const dayMeetings = meetings.filter((m) => sameDay(m.start, selected) || (m.allDay && m.start <= selected && m.end > selected));
  const today = startOfDay(new Date());

  async function allow() {
    if (await calendarPermission(true)) {
      await setupNotifications(true);
      await scheduleMeetingReminders().catch(() => {});
    }
    load();
  }

  function quickAdd() {
    const text = quick.trim();
    if (!text) return;
    setError('');
    // Parsed on the phone instantly (no AI model needed); the form opens for the user to check.
    const m = parseMeeting(text, new Date(), { defaultDay: selected });
    setQuick('');
    router.push({ pathname: '/meeting/[id]', params: { id: 'new', title: m.title, start: m.start.toISOString(), end: m.end.toISOString(), location: m.location } });
  }

  if (!allowed) {
    return (
      <View style={styles.root}>
        <Card style={{ margin: 16 }}>
          <Row>
            <CalendarIcon color={colors.navy} />
            <Text style={type.h2}>Your calendar</Text>
          </Row>
          <Text style={type.body}>Allow calendar access to see your meetings, add new ones and get a reminder before each meeting.</Text>
          <Button title="Allow calendar & reminders" onPress={allow} />
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {/* Tell Shotor about a meeting in plain words */}
        <Card>
          <Row>
            <SparkIcon color={colors.navy} />
            <Text style={type.h3}>Tell Shotor about a meeting</Text>
          </Row>
          <TextInput
            style={styles.quick}
            value={quick}
            onChangeText={setQuick}
            placeholder="e.g. Board call with Ali tomorrow 3pm at HQ"
            placeholderTextColor={colors.faint}
            onSubmitEditing={quickAdd}
            returnKeyType="done"
          />
          <Button small title="Add" onPress={quickAdd} disabled={!quick.trim()} />
          {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        </Card>

        {/* Month */}
        <Card style={{ padding: 12 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={styles.nav} accessibilityLabel="Previous month">
              <Text style={styles.navText}>‹</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelected(today);
              }}
            >
              <Text style={type.h3}>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
            </Pressable>
            <Pressable onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={styles.nav} accessibilityLabel="Next month">
              <Text style={styles.navText}>›</Text>
            </Pressable>
          </Row>
          <View style={styles.grid}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={styles.weekday}>
                {w}
              </Text>
            ))}
            {days.map((d) => {
              const inMonth = d.getMonth() === month.getMonth();
              const isSel = sameDay(d, selected);
              const isToday = sameDay(d, today);
              const n = countByDay.get(d.toDateString()) ?? 0;
              return (
                <Pressable key={d.toISOString()} style={styles.cell} onPress={() => setSelected(startOfDay(d))} accessibilityLabel={`${formatDay(d)}${n ? `, ${n} meetings` : ''}`}>
                  <View style={[styles.dayCircle, isSel && styles.daySelected, !isSel && isToday && styles.dayToday]}>
                    <Text style={[styles.dayText, !inMonth && { color: colors.faint }, isSel && { color: colors.white }, !isSel && isToday && { color: colors.navy, fontWeight: '700' }]}>{d.getDate()}</Text>
                  </View>
                  <View style={[styles.dot, { opacity: n ? 1 : 0 }, isSel && { backgroundColor: colors.navy }]} />
                </Pressable>
              );
            })}
          </View>
        </Card>

        <SectionTitle>{sameDay(selected, today) ? 'Today' : formatDay(selected)}</SectionTitle>
        {dayMeetings.length === 0 ? (
          <Empty title="No meetings" body="Tap “New meeting” or tell Shotor about one above." />
        ) : (
          dayMeetings.map((m) => (
            <Pressable key={m.id + m.start.toISOString()} onPress={() => router.push({ pathname: '/meeting/[id]', params: { id: m.id } })}>
              <Card style={[styles.meeting, { borderLeftColor: m.color }]}>
                <Text style={styles.time}>{m.allDay ? 'All day' : `${formatTime(m.start)} – ${formatTime(m.end)}`}</Text>
                <Text style={type.h3}>{m.title}</Text>
                {m.location ? <Text style={type.small}>{m.location}</Text> : null}
              </Card>
            </Pressable>
          ))
        )}
      </KeyboardAwareScrollView>
      <View style={styles.fab}>
        <Button
          title="New meeting"
          icon={<PlusIcon color={colors.white} />}
          onPress={() => router.push({ pathname: '/meeting/[id]', params: { id: 'new', date: selected.toISOString() } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  quick: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 12, fontSize: 15, color: colors.text },
  nav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navText: { fontSize: 26, color: colors.navy },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, color: colors.muted, fontWeight: '600', paddingVertical: 6 },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  daySelected: { backgroundColor: colors.navy },
  dayToday: { borderWidth: 1.5, borderColor: colors.navy },
  dayText: { fontSize: 14, color: colors.text },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent, marginTop: 2 },
  meeting: { borderLeftWidth: 4, gap: 3 },
  time: { fontSize: 13, fontWeight: '600', color: colors.navySoft },
  fab: { position: 'absolute', left: 16, right: 16, bottom: 16 },
});
