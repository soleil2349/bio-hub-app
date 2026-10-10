/**
 * BIO HUB design tokens — the single source of truth for colour, spacing,
 * radius and type across every screen.
 *
 * Visual world: CLINICAL INSTRUMENT
 * ---------------------------------
 * The first pass fixed the layout failures but kept the original palette, which
 * was the stock Tailwind dark ladder almost verbatim — bg #0A0E1A, surface
 * #111827 (gray-900), card #1F2937 (gray-800), border #374151 (gray-700),
 * muted #6B7280 (gray-500), accent #2563EB (blue-600). That is the single most
 * recognisable "default AI dark theme" in existence: a flat cool-blue-grey
 * ladder, three identical-value surface steps, a saturated stock-blue accent,
 * and eight equally-bright data hues competing with it. Nothing in it was a
 * decision.
 *
 * This palette is built instead around what the product actually is: a bedside
 * physiological monitor. Real patient monitors are near-black chrome, neutral
 * labels, and colour carried almost entirely by the traces and the numerics.
 * So:
 *
 *   - The black is deeper and tinted cyan rather than blue-grey, which reads as
 *     "instrument" instead of "admin dashboard".
 *   - Surfaces form a real luminance ladder, and raised panels carry a hairline
 *     top highlight so they read as lit from above rather than pasted on.
 *   - The accent is a desaturated instrument cyan, deliberately quieter than the
 *     stock blue it replaces, because eight data hues already own the colour.
 *   - Colour saturation is reserved for measurements (values, traces, dots).
 *     Chrome — labels, metadata, borders — stays neutral.
 *
 * Contrast contract
 * -----------------
 * Every colour in `color` is measured against all ten surfaces it can appear on
 * and clears WCAG AA (>= 4.5:1) for body text. The worst case is recorded inline.
 * Add a colour only after measuring it: the original palette shipped #4B5563
 * body text at 1.94:1, which is invisible on a dark screen.
 *
 * Two themes share this contract. Dark is the bedside instrument. Light is a
 * cool daylight bench — gray-blue paper, not warm cream — so the same vital
 * hues stay recognisable and body text still clears WCAG AA.
 */

/* ── Surfaces ────────────────────────────────────────────────────────────── */

export interface Palette {
  scheme: 'light' | 'dark';
  bg: string;
  surface: string;
  raised: string;
  subtle: string;
  raisedHigh: string;
  sunken: string;
  accentSurface: string;
  border: string;
  borderStrong: string;
  divider: string;
  highlight: string;
  sunkenEdge: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentBorder: string;
  accentLip: string;
  focus: string;
  success: string;
  successText: string;
  successSurface: string;
  danger: string;
  dangerText: string;
  dangerSurface: string;
  warning: string;
  warningText: string;
  warningSurface: string;
  successBorder: string;
  warningBorder: string;
  dangerBorder: string;
  violet: string;
  violetSurface: string;
  violetBorder: string;
  onAccent: string;
  onDanger: string;
  plotGrid: string;
  plotAxis: string;
  neutral: string;
}

export interface VitalPalette {
  hr: string;
  ecgHr: string;
  spo2: string;
  temp: string;
  sbp: string;
  dbp: string;
  pi: string;
  ptt: string;
  ecgSignal: string;
  ir: string;
}

export const darkPalette: Palette = {
  scheme: 'dark',
  /** App background — deepest layer. Never pure black. */
  bg: '#06090E',
  /** Headers and toolbars — the bezel lip above the content. */
  surface: '#0F1822',
  /** Cards and list rows — the default content surface. */
  raised: '#121B23',
  /** Inset panels sitting inside a card, one step below `raised`. */
  subtle: '#0C1319',
  /**
   * A step ABOVE `raised`. Needed because pressed states and skeleton blocks
   * sit on top of a card: with the deeper black, tinting *downward* from the
   * card is invisible. Feedback has to move up the ramp, not down it.
   * Measures 1.21:1 against `raised`.
   */
  raisedHigh: '#1E2B3A',
  /** Inset wells: waveform plots, text inputs, log blocks. */
  sunken: '#070C11',
  /** Tinted surface for selected / accented rows. */
  accentSurface: '#0A2A33',

  /* ── Borders & dividers ── */
  /** Hairline between same-value surfaces. Decorative, not a WCAG boundary. */
  border: '#1D2833',
  /** Border on interactive or emphasised edges. */
  borderStrong: '#2A3947',
  divider: '#16202A',
  /** 1px top edge on raised panels: reads as light falling from above. */
  highlight: 'rgba(255,255,255,0.055)',
  /** Darker top edge inside inset wells. */
  sunkenEdge: 'rgba(0,0,0,0.35)',

  /* ── Text ramp (all >= 4.5:1 on every surface above) ── */
  /** Primary copy, values, headings. 12.9:1 worst case. */
  text: '#E6EEF5',
  /** Secondary copy, descriptions. 9.1:1 worst case. */
  textSecondary: '#BCCBD9',
  /** Labels, metadata, units. 6.0:1 worst case. */
  textMuted: '#93A6B6',
  /** Lowest tier: footers, hints. 4.6:1 worst case. */
  textFaint: '#8799A9',

  /* ── Accent: one instrument cyan, used for interaction only ── */
  /** Fill for primary buttons. White text on it measures 5.36:1. */
  accent: '#0E7490',
  /** Brighter accent for text and icons on dark. 10.4:1 worst case. */
  accentText: '#67E8F9',
  accentBorder: '#155E75',
  /** Lit top edge on a filled accent button — the same "light from above" cue. */
  accentLip: '#1893B0',
  /** Keyboard/accessibility focus ring and active-trace indication. */
  focus: '#22D3EE',

  /* ── Semantic state ── */
  success: '#4ADE80',
  successText: '#7BE8A6',
  successSurface: '#0C2A18',
  danger: '#F87171',
  dangerText: '#FCA5A5',
  dangerSurface: '#2D1515',
  warning: '#FBBF24',
  warningText: '#FCD34D',
  warningSurface: '#2C2107',

  /* ── Tinted borders pairing with the semantic surfaces ── */
  successBorder: '#14532D',
  warningBorder: '#78350F',
  dangerBorder: '#7F1D1D',

  /* ── Violet: the SLE / NearLink identity role ── */
  violet: '#C4B5FD',
  violetSurface: '#241B3D',
  violetBorder: '#4C3A80',

  /* ── Text placed on a filled accent or danger surface ── */
  onAccent: '#FFFFFF',
  /** Text on the bright danger-red badge fill. 6.1:1 against `danger`. */
  onDanger: '#1A0505',

  /* ── Plot chrome: grid and axis lines inside waveform wells ── */
  plotGrid: '#16232E',
  plotAxis: '#24333F',

  /** Resting/unknown state. 4.5:1 worst case. */
  neutral: '#8593A0',
};

/** Daylight bench: cool gray paper, ink text, the same cyan reserved for actions. */
export const lightPalette: Palette = {
  scheme: 'light',
  bg: '#E4EDF2',
  surface: '#F7FAFB',
  raised: '#FFFFFF',
  subtle: '#F2F6F8',
  raisedHigh: '#E7EEF3',
  sunken: '#D5E0E8',
  accentSurface: '#E5F5F9',
  border: '#D0DCE4',
  borderStrong: '#B4C4D0',
  divider: '#E3EAEF',
  highlight: '#FFFFFF',
  sunkenEdge: '#C5D3DC',
  text: '#142433',
  textSecondary: '#243B4E',
  textMuted: '#3E5668',
  textFaint: '#4E6576',
  accent: '#0E7490',
  accentText: '#0B5E72',
  accentBorder: '#A9D6E4',
  accentLip: '#1490AE',
  focus: '#0E7490',
  success: '#157A3E',
  successText: '#0E6532',
  successSurface: '#E6F6EC',
  danger: '#C43535',
  dangerText: '#9E2222',
  dangerSurface: '#FDECEC',
  warning: '#9A6808',
  warningText: '#7A5206',
  warningSurface: '#FBF3DC',
  successBorder: '#B7E0C6',
  warningBorder: '#E6D199',
  dangerBorder: '#F0C2C2',
  violet: '#5B3FAA',
  violetSurface: '#F2EDFA',
  violetBorder: '#D4C7F0',
  onAccent: '#FFFFFF',
  onDanger: '#FFFFFF',
  plotGrid: '#D5E1E9',
  plotAxis: '#C3D1DB',
  neutral: '#5C7282',
};

/** @deprecated Prefer `useTheme().color` so light mode can swap the palette. */
export const color = darkPalette;

/**
 * Vital-sign trace colours.
 *
 * A measurement palette, not decoration. In a monitor the trace owns the
 * saturation and the chrome stays neutral, so each hue is applied to values,
 * dots and plot strokes — never to card borders or backgrounds.
 *
 * Each metric keeps its hue wherever it appears (live tile, trend line,
 * statistics row, report) so the eye can track one signal across screens.
 * All ten measure >= 5.8:1 on the card surface.
 */
export const darkVital: VitalPalette = {
  hr: '#F87171',
  ecgHr: '#FB923C',
  spo2: '#60A5FA',
  temp: '#34D399',
  sbp: '#A78BFA',
  dbp: '#C084FC',
  pi: '#2DD4BF',
  ptt: '#FBBF24',
  ecgSignal: '#818CF8',
  ir: '#94A3B8',
};

/** Same hues, darkened so they stay readable on white cards. */
export const lightVital: VitalPalette = {
  hr: '#C0364A',
  ecgHr: '#C05612',
  spo2: '#1B5FBF',
  temp: '#0E7A52',
  sbp: '#6A42C2',
  dbp: '#8B3CB5',
  pi: '#0C756A',
  ptt: '#8A5A08',
  ecgSignal: '#3E4CB3',
  ir: '#4E5E6C',
};

/** @deprecated Prefer `useTheme().vital`. */
export const vital = darkVital;

/* ── Spacing — one 4-unit scale, no off-scale values ─────────────────────── */

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** Horizontal gutter for screen content. Fixed at 16 so every screen aligns. */
export const SCREEN_PADDING = space.lg;

/** Cap content width on tablets / foldables so rows don't stretch absurdly. */
export const MAX_CONTENT_WIDTH = 560;

/* ── Radius — one documented system, tightened for a technical read ──────── */

export const radius = {
  /** Inputs, small buttons, chips, plots. */
  sm: 6,
  /** Cards, list rows, large buttons. */
  md: 10,
  /** Sheets, modals, hero panels. */
  lg: 14,
  /** Pills and dots. */
  pill: 999,
} as const;

/* ── Type — 6 sizes, 3 weights, one family ───────────────────────────────── */

type TypeStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
  letterSpacing?: number;
};

/**
 * Every lineHeight is >= 1.2 x fontSize: Android clips ascenders and descenders
 * aggressively below ~1.1, which is how CJK + Latin mixed labels lose strokes.
 *
 * Large sizes carry negative tracking. A readout is a measurement, not a
 * headline — tight numerals read as an instrument, loose ones read as a web page.
 */
export const type = {
  /** Big numerals: vitals, scores. Always pair with `tabularNums`. */
  metric: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6 } as TypeStyle,
  /** Screen titles. */
  h1: { fontSize: 22, lineHeight: 30, fontWeight: '700', letterSpacing: -0.2 } as TypeStyle,
  /** Card titles, section headings. */
  h2: { fontSize: 18, lineHeight: 26, fontWeight: '600' } as TypeStyle,
  /** Body copy and list values. */
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' } as TypeStyle,
  /** Form labels, metadata, buttons. */
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600' } as TypeStyle,
  /** Footnotes, hints, the smallest metadata tier. Still a reading size. */
  caption: { fontSize: 13, lineHeight: 19, fontWeight: '400' } as TypeStyle,
} as const;

/** Tabular figures keep live numbers from shifting width as they change. */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/**
 * Monospace voice for measurement readouts.
 *
 * Android and iOS both ship a usable mono face, and in this app it is doing real
 * work rather than costume: it keeps digit columns aligned and stops live values
 * from reflowing as they tick.
 */
export const monoFont = 'monospace';

/* ── Touch targets ───────────────────────────────────────────────────────── */

/** Apple HIG 44pt / Material 48dp. Anything interactive must reach this. */
export const TOUCH_TARGET = 48;

/** Use on small visible marks (icon buttons, chevrons) to reach TOUCH_TARGET. */
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

/* ── Elevation ───────────────────────────────────────────────────────────── */

/**
 * On a near-black surface a drop shadow is invisible, so hierarchy comes from a
 * lighter surface plus a hairline top highlight — the same trick physical rack
 * equipment uses to read as a separate panel.
 */
/** Raised panel chrome. Light mode uses a plain border; a top highlight only reads on near-black. */
export function raisedChrome(palette: Palette) {
  return {
    borderWidth: 1,
    borderColor: palette.border,
    borderTopColor: palette.scheme === 'dark' ? palette.highlight : palette.border,
  };
}

/** Inset wells (plots, inputs): a darker top edge. */
export function sunkenChrome(palette: Palette) {
  return {
    borderWidth: 1,
    borderColor: palette.border,
    borderTopColor: palette.sunkenEdge,
  };
}

/* ── Motion ──────────────────────────────────────────────────────────────── */

export const motion = {
  /** Product UI: fast enough to feel like a response, not a performance. */
  fast: 150,
  base: 220,
} as const;

/* ── Layering ────────────────────────────────────────────────────────────── */

/** Central z-index scale; never scatter bare zIndex values. */
export const z = {
  base: 0,
  sticky: 10,
  overlay: 100,
  modal: 200,
} as const;
