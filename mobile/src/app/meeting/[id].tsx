import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button, Card, Row, Screen, SectionTitle } from '../../components/ui';
import { DateTimeField } from '../../components/DateTimeField';
import {
  createMeeting,
  deleteMeeting,
  getMeeting,
  meetingReminder,
  openInCalendarApp,
  reminderMinutes,
  setMeetingReminder,
  setTargetCalendar,
  targetCalendarId,
  updateMeeting,
  writableCalendars,
  type WritableCalendar,
} from '../../lib/calendar';
import { scheduleMeetingReminders } from '../../lib/notifications';
import { colors, radius, type } from '../../theme';

const DURATIONS = [15, 30, 45, 60, 90, 120];
const REMINDERS = [-1, 0, 5, 10, 15, 30, 60];

function roundedNext(base = new Date()) {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

/** Create (id = "new") or edit a meeting. Optional params prefill the form (from the calendar or AI quick add). */
export default function MeetingEditor() {
  const p = useLocalSearchParams<{ id: string; date?: string; title?: string; start?: string; end?: string; location?: string; notes?: string }>();
  const isNew = p.id === 'new';

  const initialStart = p.start ? new Date(p.start) : p.date ? withTime(new Date(p.date), roundedNext()) : roundedNext();
  const [title, setTitle] = useState(p.title ?? '');
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(p.end ? new Date(p.end) : new Date(initialStart.getTime() + 60 * 60000));
  const [location, setLocation] = useState(p.location ?? '');
  const [notes, setNotes] = useState(p.notes ?? '');
  const [reminder, setReminder] = useState(reminderMinutes());
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState<null | 'recurring' | 'locked'>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        if (isNew) {
          setCalendars(await writableCalendars());
          setCalendarId(await targetCalendarId());
          return;
        }
        const m = await getMeeting(p.id);
        if (!m) return setError('This meeting no longer exists.');
        setTitle(m.title);
        setStart(m.start);
        setEnd(m.end);
        setLocation(m.location);
        setNotes(m.notes);
        setReminder(meetingReminder(m.id));
        if (m.recurring) setReadOnly('recurring');
        else if (!m.editable) setReadOnly('locked');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [isNew, p.id]);

  const duration = Math.round((end.getTime() - start.getTime()) / 60000);

  function changeStart(d: Date) {
    // Moving the start keeps the meeting length.
    setEnd(new Date(d.getTime() + Math.max(duration, 15) * 60000));
    setStart(d);
  }

  async function save() {
    if (!title.trim()) return setError('Add a title for the meeting.');
    setError('');
    setSaving(true);
    try {
      const input = { title, start, end, location, notes, reminderMinutes: reminder };
      if (isNew) {
        if (calendarId) setTargetCalendar(calendarId);
        await createMeeting(input);
      } else {
        await updateMeeting(p.id, input);
      }
      await scheduleMeetingReminders().catch(() => {});
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    Alert.alert('Delete meeting?', 'It will be removed from your phone calendar (and Google Calendar once synced).', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMeeting(p.id);
            await scheduleMeetingReminders().catch(() => {});
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  }

  const calendarName = calendars.find((c) => c.id === calendarId);

  return (
    <Screen>
      <Stack.Screen options={{ title: isNew ? 'New meeting' : 'Meeting' }} />
      {loading ? <Text style={type.small}>Loading…</Text> : null}
      {readOnly ? (
        <Card style={{ backgroundColor: '#E3E9F5' }}>
          <Text style={type.body}>
            {readOnly === 'recurring'
              ? 'This is a repeating meeting. Edit it in your calendar app so all occurrences stay correct.'
              : 'This meeting belongs to a calendar Shotor cannot change (for example, an invite from someone else).'}
          </Text>
          <Button small variant="secondary" title="Open in calendar app" onPress={() => openInCalendarApp(p.id).catch((e) => setError(String(e?.message ?? e)))} />
        </Card>
      ) : null}

      <TextInput
        style={[styles.input, styles.title]}
        placeholder="Meeting title"
        placeholderTextColor={colors.faint}
        value={title}
        onChangeText={setTitle}
        editable={!readOnly}
        autoFocus={isNew && !p.title}
      />

      <DateTimeField label="Date" mode="date" value={start} onChange={changeStart} />
      <Row>
        <View style={{ flex: 1 }}>
          <DateTimeField label="Starts" mode="time" value={start} onChange={changeStart} />
        </View>
        <View style={{ flex: 1 }}>
          <DateTimeField label="Ends" mode="time" value={end} onChange={(d) => setEnd(withTime(start, d))} />
        </View>
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        {DURATIONS.map((m) => (
          <Chip key={m} label={m < 60 ? `${m} min` : `${m / 60} h`} active={duration === m} onPress={() => setEnd(new Date(start.getTime() + m * 60000))} disabled={!!readOnly} />
        ))}
      </Row>

      <TextInput style={styles.input} placeholder="Location or call link (optional)" placeholderTextColor={colors.faint} value={location} onChangeText={setLocation} editable={!readOnly} />
      <TextInput
        style={[styles.input, { minHeight: 90 }]}
        placeholder="Notes / agenda (optional)"
        placeholderTextColor={colors.faint}
        value={notes}
        onChangeText={setNotes}
        multiline
        textAlignVertical="top"
        editable={!readOnly}
      />

      <SectionTitle>Remind me</SectionTitle>
      <Row style={{ flexWrap: 'wrap' }}>
        {REMINDERS.map((m) => (
          <Chip key={m} label={m < 0 ? 'No reminder' : m === 0 ? 'At start' : m >= 60 ? '1 hour before' : `${m} min before`} active={reminder === m} onPress={() => setReminder(m)} />
        ))}
      </Row>

      {isNew && calendars.length > 1 ? (
        <>
          <SectionTitle>Save to</SectionTitle>
          <Row style={{ flexWrap: 'wrap' }}>
            {calendars.map((c) => (
              <Chip key={c.id} label={c.account && c.account !== c.title ? `${c.title} · ${c.account}` : c.title} active={c.id === calendarId} onPress={() => setCalendarId(c.id)} />
            ))}
          </Row>
        </>
      ) : isNew && calendarName ? (
        <Text style={type.tiny}>Saved to: {calendarName.title}</Text>
      ) : null}

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      {readOnly ? (
        <Button title="Save reminder" onPress={async () => { await updateReminderOnly(p.id, reminder); router.back(); }} />
      ) : (
        <Button title={isNew ? 'Save meeting' : 'Save changes'} onPress={save} loading={saving} />
      )}
      {!isNew && !readOnly ? <Button variant="danger" title="Delete meeting" onPress={remove} /> : null}
    </Screen>
  );
}

async function updateReminderOnly(id: string, minutes: number) {
  setMeetingReminder(id, minutes);
  await scheduleMeetingReminders().catch(() => {});
}

function withTime(day: Date, time: Date) {
  const d = new Date(day);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

function Chip({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: colors.white, borderRadius: radius.md, padding: 13, fontSize: 15, color: colors.text, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  title: { fontSize: 18, fontWeight: '600' },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
});
