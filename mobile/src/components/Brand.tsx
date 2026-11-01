import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, serif } from '../theme';

/** Path data for the Aether Link "AL" monogram (1600x1600 artboard). Shared by the logo and the watermark. */
const A_AND_BAR =
  'M712 475 L958 1010 L1215 1010 L1178 1092 L898 1092 L710 673 L623 848 L760 848 L795 931 L582 931 L497 1100 Q480 1150 505 1200 L470 1212 L385 1135 Z';
const L_STEM = 'M864 490 Q905 492 948 510 L948 915 L864 738 Z';
// White ring broken where the letters cut through it (left of the A, right of the L bar).
const RING_TOP = 'M369 1081 A515 515 0 1 1 1225 1090';
const RING_BOTTOM = 'M1194 1131 A515 515 0 0 1 470 1195';

type LogoProps = { size?: number; color?: string; letterColor?: string };

/** The AL monogram: navy disc, white ring, white letters. */
export function LogoMark({ size = 32, color = colors.navyDeep, letterColor = colors.white }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="200 200 1200 1200" accessibilityLabel="Aether Link logo">
      <Circle cx={800} cy={800} r={595} fill={color} />
      <Path d={RING_TOP} stroke={letterColor} strokeWidth={30} fill="none" />
      <Path d={RING_BOTTOM} stroke={letterColor} strokeWidth={30} fill="none" />
      <Path d={A_AND_BAR} fill={letterColor} />
      <Path d={L_STEM} fill={letterColor} />
    </Svg>
  );
}

/** A large, very faint monogram used as a background watermark on empty screens. */
export function Watermark({ size = 260, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View pointerEvents="none" style={[styles.watermark, style]}>
      <Svg width={size} height={size} viewBox="200 200 1200 1200" opacity={0.05}>
        <Circle cx={800} cy={800} r={595} fill="none" stroke={colors.navyDeep} strokeWidth={60} />
        <Path d={RING_TOP} stroke={colors.navyDeep} strokeWidth={30} fill="none" />
        <Path d={RING_BOTTOM} stroke={colors.navyDeep} strokeWidth={30} fill="none" />
        <Path d={A_AND_BAR} fill={colors.navyDeep} />
        <Path d={L_STEM} fill={colors.navyDeep} />
      </Svg>
    </View>
  );
}

/** "from AETHER LINK" — company attribution shown at the bottom of key screens. */
export function FromAetherLink({ light = false }: { light?: boolean }) {
  const c = light ? 'rgba(255,255,255,0.85)' : colors.navy;
  return (
    <View style={styles.from} accessibilityLabel="from Aether Link">
      <Text style={[styles.fromSmall, { color: light ? 'rgba(255,255,255,0.6)' : colors.muted }]}>from</Text>
      <View style={styles.fromRow}>
        <LogoMark size={18} color={light ? colors.white : colors.navyDeep} letterColor={light ? colors.navyDeep : colors.white} />
        <Text style={[styles.fromBrand, { color: c }]}>AETHER LINK</Text>
      </View>
    </View>
  );
}

/** App title with the logo on the left, used in screen headers. */
export function HeaderTitle({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <LogoMark size={30} />
      <Text style={styles.headerText} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: { position: 'absolute', alignSelf: 'center', top: '22%' },
  from: { alignItems: 'center', paddingVertical: 16, gap: 4 },
  fromSmall: { fontSize: 12, letterSpacing: 0.5 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fromBrand: { fontFamily: serif, fontSize: 14, letterSpacing: 3, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { fontSize: 19, fontWeight: '700', color: colors.ink },
});
