import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { colors, serif } from '../theme';

/**
 * The Aether Nova symbol (a stylised "A" with an orbit), the same vector as the company website's
 * assets/logo.svg (viewBox 255 245 1030 610). Full colour on light backgrounds, white on dark ones.
 */
const VIEWBOX = '255 245 1030 610';
const RATIO = 610 / 1030;

const A_SHAPE = 'M672 292 Q707 252 742 292 L1157 793 L992 802 Q968 803 960 790 L700 432 L597 610 L397 671 Z';
const FOLD = 'M700 432 L712 458 L604 614 L498 640 Z';
const BLADE = 'M430 712 C560 688 760 690 880 755 C835 700 790 665 720 650 L470 690 Z';
const ORBIT =
  'M525 803 C430 822 300 845 274 800 C252 760 340 722 470 704 C640 668 840 612 985 565 C1130 495 1270 400 1268 330 ' +
  'C1266 270 1160 258 1060 275 C990 287 920 315 870 347 C960 312 1070 292 1125 305 C1170 316 1165 360 1120 410 ' +
  'C1070 465 1010 505 950 527 C820 560 640 600 470 652 C350 688 296 735 304 772 C314 812 420 812 525 803 Z';
const ORBIT_EDGE = 'M880 345 C960 314 1068 294 1122 306 C1166 318 1160 362 1116 412 C1066 466 1008 505 952 527';

type LogoProps = { size?: number; light?: boolean };

/** The Aether Nova symbol. `size` is its width; it is about 0.6 times as tall. */
export function LogoMark({ size = 32, light = false }: LogoProps) {
  if (light) {
    // One colour (white) for dark backgrounds such as the lock screen and setup.
    return (
      <Svg width={size} height={size * RATIO} viewBox={VIEWBOX} accessibilityLabel="Aether Nova logo">
        <G fill={colors.white}>
          <Path d={A_SHAPE} />
          <Path d={BLADE} opacity={0.85} />
          <Path d={ORBIT} />
        </G>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size * RATIO} viewBox={VIEWBOX} accessibilityLabel="Aether Nova logo">
      <Defs>
        <LinearGradient id="an-a" x1="480" y1="300" x2="1150" y2="800" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#06123f" />
          <Stop offset="0.42" stopColor="#0a3db8" />
          <Stop offset="0.75" stopColor="#0a8cff" />
          <Stop offset="1" stopColor="#9a1bff" />
        </LinearGradient>
        <LinearGradient id="an-fold" x1="700" y1="440" x2="560" y2="630" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#020a2e" />
          <Stop offset="1" stopColor="#0a2a8a" />
        </LinearGradient>
        <LinearGradient id="an-blade" x1="450" y1="700" x2="880" y2="750" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#0a2a8a" />
          <Stop offset="0.6" stopColor="#0b5be6" />
          <Stop offset="1" stopColor="#17a8ff" />
        </LinearGradient>
        <LinearGradient id="an-orbit" x1="270" y1="800" x2="1270" y2="300" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#0a1a7a" />
          <Stop offset="0.22" stopColor="#1238d8" />
          <Stop offset="0.42" stopColor="#16d2ff" />
          <Stop offset="0.6" stopColor="#1e8bff" />
          <Stop offset="0.82" stopColor="#2a3cff" />
          <Stop offset="1" stopColor="#a21cff" />
        </LinearGradient>
        <RadialGradient id="an-glow" cx="900" cy="540" r="140" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.9} />
          <Stop offset="0.35" stopColor="#bff4ff" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#bff4ff" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Path fill="url(#an-a)" d={A_SHAPE} />
      <Path fill="url(#an-fold)" d={FOLD} />
      <Path fill="url(#an-blade)" d={BLADE} />
      <Path fill="url(#an-orbit)" d={ORBIT} />
      <Path d={ORBIT_EDGE} fill="none" stroke="#7ff3ff" strokeWidth={7} strokeLinecap="round" opacity={0.75} />
      <Ellipse cx="900" cy="540" rx="140" ry="22" transform="rotate(-18 900 540)" fill="url(#an-glow)" />
    </Svg>
  );
}

/** A large, very faint symbol used as a background watermark on empty screens. */
export function Watermark({ size = 300, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View pointerEvents="none" style={[styles.watermark, style]}>
      <Svg width={size} height={size * RATIO} viewBox={VIEWBOX} opacity={0.05}>
        <G fill={colors.navyDeep}>
          <Path d={A_SHAPE} />
          <Path d={BLADE} />
          <Path d={ORBIT} />
        </G>
      </Svg>
    </View>
  );
}

/** "from AETHER NOVA": company attribution shown at the bottom of key screens. */
export function FromAetherNova({ light = false }: { light?: boolean }) {
  const c = light ? 'rgba(255,255,255,0.85)' : colors.navy;
  return (
    <View style={styles.from} accessibilityLabel="from Aether Nova">
      <Text style={[styles.fromSmall, { color: light ? 'rgba(255,255,255,0.6)' : colors.muted }]}>from</Text>
      <View style={styles.fromRow}>
        <LogoMark size={28} light={light} />
        <Text style={[styles.fromBrand, { color: c }]}>AETHER NOVA</Text>
      </View>
    </View>
  );
}

/** App title with the logo on the left, used in screen headers. */
export function HeaderTitle({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <LogoMark size={40} />
      <Text style={styles.headerText} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  watermark: { position: 'absolute', alignSelf: 'center', top: '24%' },
  from: { alignItems: 'center', paddingVertical: 16, gap: 4 },
  fromSmall: { fontSize: 12, letterSpacing: 0.5 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fromBrand: { fontFamily: serif, fontSize: 14, letterSpacing: 3, fontWeight: '600' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { fontSize: 19, fontWeight: '700', color: colors.ink },
});
