import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radius, space, type } from '../theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[styles.card, style as ViewStyle]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  style?: ViewStyle;
  small?: boolean;
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, style, small }: ButtonProps) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        v.box,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.text.color as string} /> : icon}
      <Text style={[styles.buttonText, small && { fontSize: 14 }, v.text]}>{title}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<string, { box: ViewStyle; text: TextStyle }> = {
  primary: { box: { backgroundColor: colors.navy }, text: { color: colors.white } },
  secondary: { box: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, text: { color: colors.navy } },
  ghost: { box: { backgroundColor: 'transparent' }, text: { color: colors.accent } },
  danger: { box: { backgroundColor: colors.dangerBg }, text: { color: colors.danger } },
};

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warn' | 'danger' | 'navy' }) {
  const t = {
    neutral: { bg: '#EEF2F7', fg: colors.muted },
    success: { bg: colors.successBg, fg: colors.success },
    warn: { bg: colors.warnBg, fg: colors.warn },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    navy: { bg: '#E3E9F5', fg: colors.navy },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  if (!scroll) return <View style={[styles.screen, padded && styles.padded]}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[padded && styles.padded, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={type.h3}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: space.lg, gap: space.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: 13,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  buttonSmall: { paddingVertical: 8, paddingHorizontal: space.md },
  buttonText: { fontSize: 15, fontWeight: '600' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', gap: space.sm, padding: space.xl },
});
