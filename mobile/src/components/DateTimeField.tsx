import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { colors, radius } from '../theme';

type Props = { label: string; value: Date; mode: 'date' | 'time'; onChange: (d: Date) => void };

/** Tap-to-pick date or time. Android opens the system dialog; iOS shows the compact inline picker. */
export function DateTimeField({ label, value, mode, onChange }: Props) {
  const text =
    mode === 'date'
      ? value.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (Platform.OS === 'ios') {
    return (
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <DateTimePicker value={value} mode={mode} display="compact" onChange={(_, d) => d && onChange(merge(value, d, mode))} />
      </View>
    );
  }

  const open = () =>
    DateTimePickerAndroid.open({
      value,
      mode,
      is24Hour: !/[AP]M/i.test(new Date(2020, 0, 1, 13).toLocaleTimeString()),
      onChange: (event, d) => {
        if (event.type === 'set' && d) onChange(merge(value, d, mode));
      },
    });

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.row, styles.box, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{text}</Text>
    </Pressable>
  );
}

/** Keeps the time when changing the date, and the date when changing the time. */
function merge(prev: Date, picked: Date, mode: 'date' | 'time') {
  const d = new Date(prev);
  if (mode === 'date') d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  else d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return d;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  box: { backgroundColor: colors.white, borderRadius: radius.md, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  label: { fontSize: 15, color: colors.muted },
  value: { fontSize: 15, fontWeight: '600', color: colors.navy },
});
