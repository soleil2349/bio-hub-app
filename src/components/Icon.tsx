/**
 * Icon set — a single family, authored as SVG paths on one 24x24 grid.
 *
 * Why hand-authored instead of a glyph font
 * -----------------------------------------
 * The screens previously used text characters as icons (`\u26A1` for scanning,
 * `\u2728` for empty states, `\u25B2`/`\u25BC` for expand, `\uD83D\uDCA1` for the LED
 * button, `\u2581\u2583\u2585\u2587` as signal bars). Those render at whatever weight,
 * baseline and colour the device font decides, differ per platform, and cannot
 * be aligned with anything. `react-native-svg` is already a dependency, so the
 * marks are drawn here instead: one grid, one stroke width, one cap style.
 *
 * Rules for adding an icon
 * ------------------------
 *  - Stay inside the 24x24 viewBox, keeping ~3px of optical padding.
 *  - Use only the shared stroke attributes set on `<Svg>`; do not override
 *    `strokeWidth` per icon — the family's consistency is the point.
 *  - Prefer open strokes over filled shapes so icons read as one set.
 */
import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTheme } from '../theme-context';

/** Shared family constants. */
const GRID = 24;
const STROKE_WIDTH = 1.75;

export type IconName =
  /* Navigation */
  | 'bluetooth'
  | 'cloud'
  | 'clock'
  | 'sliders'
  /* Device tabs */
  | 'activity'
  | 'trend'
  | 'barChart'
  | 'terminal'
  /* Directional */
  | 'chevronRight'
  | 'chevronDown'
  | 'chevronUp'
  | 'arrowUp'
  | 'arrowDown'
  /* Actions */
  | 'play'
  | 'pause'
  | 'bulb'
  | 'upload'
  | 'download'
  | 'trash'
  | 'refresh'
  | 'close'
  | 'check'
  | 'alert'
  | 'logout'
  /* Status & objects */
  | 'signal'
  | 'server'
  | 'wifi'
  | 'user'
  | 'lock'
  | 'info'
  | 'fileText'
  | 'zap'
  | 'heart'
  | 'droplet'
  | 'search';

const GLYPHS: Record<IconName, React.ReactNode> = {
  /* ── Navigation ── */
  bluetooth: <Path d="M7 7l10 10-5 4V3l5 5-10 10" />,
  cloud: <Path d="M18 10h-1.26A8 8 0 1 0 9 20h9a4 4 0 0 0 0-8z" />,
  clock: (
    <>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 7.5V12l3 1.8" />
    </>
  ),
  sliders: (
    <Path d="M5 20v-6M5 10V4M12 20v-8M12 8V4M19 20v-4M19 12V4M2 14h6M9 12h6M16 16h6" />
  ),

  /* ── Device tabs ── */
  activity: <Path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  trend: <Path d="M3 16.5l4.5-6 3.5 3.5L15 7l6 6" />,
  barChart: (
    <>
      <Path d="M5 20V11M12 20V5M19 20v-6" />
      <Path d="M3 20h18" />
    </>
  ),
  terminal: (
    <>
      <Rect x={3} y={4.5} width={18} height={15} rx={2} />
      <Path d="M7.5 9.5l3 3-3 3M13 15.5h4" />
    </>
  ),

  /* ── Directional ── */
  chevronRight: <Path d="M9.5 5.5l6.5 6.5-6.5 6.5" />,
  chevronDown: <Path d="M5.5 9l6.5 6.5L18.5 9" />,
  chevronUp: <Path d="M5.5 15l6.5-6.5L18.5 15" />,
  arrowUp: <Path d="M12 19.5V5M6 11l6-6 6 6" />,
  arrowDown: <Path d="M12 4.5V19M6 13l6 6 6-6" />,

  /* ── Actions ── */
  play: <Path d="M8.5 5.5L18.5 12l-10 6.5V5.5Z" />,
  pause: (
    <>
      <Rect x={7.5} y={5.5} width={3.5} height={13} rx={1.25} />
      <Rect x={13} y={5.5} width={3.5} height={13} rx={1.25} />
    </>
  ),
  bulb: (
    <>
      <Path d="M12 3a5.5 5.5 0 0 0-3.3 9.9c.6.5 1 1.2 1 2v.6h4.6v-.6c0-.8.4-1.5 1-2A5.5 5.5 0 0 0 12 3Z" />
      <Path d="M9.7 18.5h4.6M10.6 21h2.8" />
    </>
  ),
  upload: (
    <Path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  ),
  download: (
    <Path d="M12 4v11.5M7.5 11L12 15.5 16.5 11M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />
  ),
  trash: (
    <>
      <Path d="M4 6.5h16M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7" />
      <Path d="M6.5 6.5l.9 12.2a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.9-12.2" />
      <Path d="M10.5 10.5v6M13.5 10.5v6" />
    </>
  ),
  refresh: (
    <>
      <Path d="M21 5v5.5h-5.5" />
      <Path d="M18.6 14.6a8.3 8.3 0 1 1-2-8.6L21 10.5" />
    </>
  ),
  close: <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7" />,
  alert: (
    <>
      <Path d="M12 3.8L21.3 20H2.7L12 3.8Z" />
      <Path d="M12 10v4.2M12 17.2v.2" />
    </>
  ),
  logout: (
    <>
      <Path d="M15 8.5V6a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 18v-2.5" />
      <Path d="M10 12h10M17 9l3 3-3 3" />
    </>
  ),

  /* ── Status & objects ── */
  signal: <Path d="M4 19v-3M9.3 19v-6M14.7 19v-9M20 19V7" />,
  server: (
    <>
      <Rect x={3.5} y={4.5} width={17} height={6} rx={2} />
      <Rect x={3.5} y={13.5} width={17} height={6} rx={2} />
      <Path d="M7 7.5v.2M7 16.5v.2" />
    </>
  ),
  wifi: (
    <>
      <Path d="M4 9.5a12 12 0 0 1 16 0M7 13a7.7 7.7 0 0 1 10 0M9.8 16.4a3.4 3.4 0 0 1 4.4 0" />
      <Path d="M12 19.6v.2" />
    </>
  ),
  user: (
    <>
      <Circle cx={12} cy={8} r={3.8} />
      <Path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  lock: (
    <>
      <Rect x={4.5} y={10.5} width={15} height={9.5} rx={2} />
      <Path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </>
  ),
  info: (
    <>
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  fileText: (
    <>
      <Path d="M6.5 3.5h7L18 8v12.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <Path d="M13.5 3.5V8H18M8.5 12.5h7M8.5 16h4.5" />
    </>
  ),
  zap: <Path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />,
  heart: (
    <Path d="M12 20.3l-7.1-7.1a4.6 4.6 0 0 1 6.5-6.5l.6.6.6-.6a4.6 4.6 0 0 1 6.5 6.5l-7.1 7.1Z" />
  ),
  droplet: (
    <Path d="M12 3.5s5.5 6 5.5 9.8a5.5 5.5 0 0 1-11 0C6.5 9.5 12 3.5 12 3.5Z" />
  ),
  search: (
    <>
      <Circle cx={10.5} cy={10.5} r={6.5} />
      <Path d="M15.5 15.5L21 21" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** Rendered box size in px. Defaults to a 20px icon. */
  size?: number;
  color?: string;
  /** Opacity applied to the whole mark; use for disabled affordances. */
  opacity?: number;
}

export default function Icon({ name, size = 20, color, opacity }: IconProps) {
  const { color: palette } = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      fill="none"
      stroke={color ?? palette.text}
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    >
      {GLYPHS[name]}
    </Svg>
  );
}
