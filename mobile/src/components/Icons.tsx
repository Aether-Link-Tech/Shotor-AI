import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type P = { size?: number; color: ColorValue };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none' as const });
const s = (color: ColorValue) => ({ stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const });

export const HomeIcon = ({ size = 24, color }: P) => (
  <Svg {...base(size)}><Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" {...s(color)} /></Svg>
);
export const ReportIcon = ({ size = 24, color }: P) => (
  <Svg {...base(size)}>
    <Path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" {...s(color)} />
    <Path d="M14 3v5h5M8.5 13h7M8.5 17h5" {...s(color)} />
  </Svg>
);
export const ChatIcon = ({ size = 24, color }: P) => (
  <Svg {...base(size)}><Path d="M4 5h16v11H9l-5 4z" {...s(color)} /><Path d="M8 10h8M8 13h5" {...s(color)} /></Svg>
);
export const MailIcon = ({ size = 24, color }: P) => (
  <Svg {...base(size)}><Rect x={3} y={5} width={18} height={14} rx={2} {...s(color)} /><Path d="m4 7 8 6 8-6" {...s(color)} /></Svg>
);
export const SettingsIcon = ({ size = 24, color }: P) => (
  <Svg {...base(size)}>
    <Circle cx={12} cy={12} r={3} {...s(color)} />
    <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" {...s(color)} />
  </Svg>
);
export const CalendarIcon = ({ size = 20, color }: P) => (
  <Svg {...base(size)}><Rect x={3} y={5} width={18} height={16} rx={2} {...s(color)} /><Path d="M3 10h18M8 3v4M16 3v4" {...s(color)} /></Svg>
);
export const SendIcon = ({ size = 20, color }: P) => (
  <Svg {...base(size)}><Path d="M4 12 20 4l-6 16-3-7z" {...s(color)} /><Path d="m11 13 9-9" {...s(color)} /></Svg>
);
export const PlusIcon = ({ size = 20, color }: P) => (
  <Svg {...base(size)}><Path d="M12 5v14M5 12h14" {...s(color)} /></Svg>
);
export const SparkIcon = ({ size = 20, color }: P) => (
  <Svg {...base(size)}><Path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" {...s(color)} /></Svg>
);
export const CloudOffIcon = ({ size = 18, color }: P) => (
  <Svg {...base(size)}><Path d="M3 3l18 18M8 7.5A5 5 0 0 1 17 10a4 4 0 0 1 3 6.5M17.5 18H7a4 4 0 0 1-1.5-7.7" {...s(color)} /></Svg>
);
