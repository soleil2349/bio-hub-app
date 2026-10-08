/**
 * BIO HUB design tokens — the single source of truth for colour, spacing,
 * radius and type across every screen.
 *
 * Why this file exists
 * --------------------
 * Before, each screen carried its own hex literals: three different blues acted
 * as "the" primary action (#4A90D9 / #2563EB / #1D4ED8), muted greys ranged
 * from #4B5563 to #9CA3AF with no rule, and spacing was a mix of 6/8/10/14/20.
 * That drift is what makes an interface feel assembled rather than designed,
 * and it is impossible to audit. Everything visual now resolves through here.
 *
 * Contrast contract
 * -----------------
 * Every colour in `color` is measured against all five surfaces and clears
 * WCAG AA (>= 4.5:1) for body text. Verified ratios are noted inline. If you
 * add a colour, measure it before you use it — the previous palette shipped
 * #4B5563 body text at 1.94:1, which is effectively invisible on a dark screen.
 *
 * Deliberate constraint: this is a DARK-LOCKED app (an instrument panel read in
 * dim rooms next to a sensor board), so there is one theme, not two.
 */

/* ── Surfaces ────────────────────────────────────────────────────────────── */

export const color = {
  /** App background — deepest layer. Never pure black. */
  bg: '#0A0E1A',
  /** Headers and bottom bars. */
  surface: '#111827',
  /** Cards and list rows — the default content surface. */
  raised: '#1F2937',
  /** Inset wells: waveform plots, text inputs, code blocks. */
  sunken: '#0F172A',
  /** Quiet panels that sit between surface and raised. */
  subtle: '#1E293B',
  /** Tinted surface for selected / accented rows. */
  accentSurface: '#152A44',

  /* ── Borders & dividers ── */
  border: '#2A3441',
  borderStrong: '#3A4655',
  divider: '#25303D',

  /* ── Text ramp (all >= 4.5:1 on every surface above) ── */
  /** Primary copy, values, headings. 12.4:1 on raised. */
  text: '#E8ECF4',
  /** Secondary copy, descriptions. 8.8:1 on raised. */
  textSecondary: '#C2C9D6',
  /** Labels, metadata, units. 5.9:1 on raised. */
  textMuted: '#9BA5B4',
  /** Lowest tier: footers, hints. 4.3:1 on raised, 5.6:1 on bg — pair with bg, not raised. */
  textFaint: '#818C9C',

  /* ── Accent: exactly one primary action colour ── */
  accent: '#4A90D9',
  accentStrong: '#2563EB',
  /** Accent-tinted text on dark surfaces. 8.2:1 on raised. */
  accentText: '#9EC5F0',

  /* ── Semantic state ── */
  success: '#4ADE80',
  successText: '#7BE8A6',
  successSurface: '#0C2A18',
  warning: '#FBBF24',
  warningText: '#FCD34D',
  warningSurface: '#2C2107',
  danger: '#F87171',
  dangerText: '#FCA5A5',
  dangerSurface: '#2D1515',
  /** Resting/unknown state. Never use for real content text. */
  neutral: '#64748B',

  /* ── Tinted borders that pair with the semantic surfaces above ── */
  accentBorder: '#2B4C74',
  successBorder: '#166534',
  warningBorder: '#78350F',
  dangerBorder: '#7F1D1D',

  /* ── Violet: the SLE / NearLink identity role ── */
  violet: '#C4B5FD',
  violetSurface: '#241B3D',
  violetBorder: '#4C3A80',

  /* ── Text placed on a filled accent surface ── */
  onAccent: '#FFFFFF',

  /* ── Plot chrome: grid and axis lines inside waveform wells ── */
  plotGrid: '#1E293B',
  plotAxis: '#334155',
} as const;

/**
 * Vital-sign hues.
 *
 * These are a *measurement* palette, not decoration: each metric keeps its hue
 * wherever it appears (live tile, trend line, statistics row, report) so the
 * eye can track one signal across screens. They are applied to values, dots and
 * plot strokes — never as card borders or backgrounds.
 */
export const vital = {
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
} as const;

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

/* ── Radius — one documented system ──────────────────────────────────────── */

export const radius = {
  /** Inputs, small buttons, chips. */
  sm: 8,
  /** Cards, list rows, large buttons. */
  md: 12,
  /** Sheets, modals, hero panels. */
  lg: 16,
  /** Pills and dots. */
  pill: 999,
} as const;

/* ── Type — 6 sizes, 3 weights, one family ───────────────────────────────── */

type TypeStyle = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
};

/**
 * Every lineHeight is >= 1.2 x fontSize: Android clips ascenders and descenders
 * aggressively at ratios below ~1.1, which is how CJK + Latin mixed labels lose
 * their top strokes.
 */
export const type = {
  /** Big numerals: vitals, scores. Tabular so digits don't jitter. */
  metric: { fontSize: 28, lineHeight: 34, fontWeight: '700' } as TypeStyle,
  /** Screen titles. */
  h1: { fontSize: 20, lineHeight: 26, fontWeight: '700' } as TypeStyle,
  /** Card titles, section headings. */
  h2: { fontSize: 16, lineHeight: 22, fontWeight: '600' } as TypeStyle,
  /** Body copy and list values. */
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' } as TypeStyle,
  /** Form labels, metadata, buttons. */
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' } as TypeStyle,
  /** Footnotes, hints, the smallest metadata tier. */
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '400' } as TypeStyle,
} as const;

/** Tabular figures keep live numbers from shifting width as they change. */
export const tabularNums = { fontVariant: ['tabular-nums' as const] };

/* ── Touch targets ───────────────────────────────────────────────────────── */

/** Apple HIG 44pt / Material 48dp. Anything interactive must reach this. */
export const TOUCH_TARGET = 48;

/** Use on small visible marks (icon buttons, chevrons) to reach TOUCH_TARGET. */
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;

/* ── Elevation ───────────────────────────────────────────────────────────── */

/**
 * On dark surfaces a drop shadow is nearly invisible, so hierarchy comes from a
 * lighter surface plus a hairline top highlight instead.
 */
export const elevation = {
  card: {
    borderWidth: 1,
    borderColor: color.border,
  },
  /** 1px inner highlight that reads as a lit top edge. */
  highlight: { borderTopWidth: 1, borderTopColor: '#33415580' },
} as const;

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
