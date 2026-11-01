import { Platform } from 'react-native';

/** Aether Link brand palette (navy taken from the company logo). */
export const colors = {
  navy: '#0A1F44',
  navyDeep: '#041C42',
  navySoft: '#1C3566',
  ink: '#0F172A',
  text: '#1E293B',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#E2E8F0',
  bg: '#F5F6F8',
  card: '#FFFFFF',
  accent: '#2F6FED',
  success: '#15803D',
  successBg: '#DCFCE7',
  warn: '#B45309',
  warnBg: '#FEF3C7',
  danger: '#B91C1C',
  dangerBg: '#FEE2E2',
  white: '#FFFFFF',
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 22 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const type = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.ink },
  h2: { fontSize: 18, fontWeight: '700' as const, color: colors.ink },
  h3: { fontSize: 15, fontWeight: '700' as const, color: colors.ink },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  tiny: { fontSize: 11, color: colors.faint },
};
