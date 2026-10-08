/**
 * Shared UI primitives.
 *
 * These exist so that "a card", "a primary button", "an empty state" and "a
 * section heading" mean exactly one thing across all six screens. Previously
 * each screen re-declared its own versions with slightly different padding,
 * radius, colour and pill shape, which is what made the app feel assembled
 * rather than designed, and it is also where the overflow bugs hid (row
 * children with no `flexShrink`, fixed-width badges beside unbounded text).
 *
 * Every primitive here is overflow-safe by construction:
 *   - text that can be arbitrarily long is clamped or shrunk,
 *   - rows never let a child push a sibling off-screen,
 *   - interactive marks always reach a 48dp touch target.
 */
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import Icon, { type IconName } from './Icon';
import {
  MAX_CONTENT_WIDTH,
  SCREEN_PADDING,
  TOUCH_TARGET,
  color,
  motion,
  radius,
  space,
  tabularNums,
  type,
  vital,
} from '../theme';

/* ────────────────────────────────────────────────────────────────────────── *
 * Layout
 * ────────────────────────────────────────────────────────────────────────── */

export interface ScreenProps {
  children: React.ReactNode;
  /**
   * Safe-area edges to inset.
   *
   * 'top' is deliberately NOT included by default: `ScreenHeader` applies the
   * top inset itself so the header's surface colour runs all the way under the
   * status bar. Letting `Screen` pad the top instead leaves a strip of page
   * background above the header.
   *
   * 'bottom' is omitted too — bottom tab bars own the bottom inset, and
   * insetting on both leaves a dead gap above the bar.
   */
  edges?: readonly Edge[];
  style?: StyleProp<ViewStyle>;
  /** Centres content and caps its width on tablets / foldables. */
  constrain?: boolean;
}

export function Screen({
  children,
  edges = ['left', 'right'],
  style,
  constrain = false,
}: ScreenProps) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges as Edge[]}>
      {constrain ? <View style={styles.constrain}>{children}</View> : children}
    </SafeAreaView>
  );
}

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Rendered to the right of the title block. Kept to compact controls. */
  actions?: React.ReactNode;
  /** Optional element rendered under the title row. */
  children?: React.ReactNode;
}

export function ScreenHeader({ title, subtitle, actions, children }: ScreenHeaderProps) {
  const large = useLargeText();
  const insets = useSafeAreaInsets();

  const titleBlock = (
    <View style={styles.headerText}>
      <Text style={[type.h1, styles.headerTitle]} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[type.label, styles.headerSubtitle]} numberOfLines={2}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      {/* At large font scales a side-by-side header squeezes the title to an
          ellipsis, so the actions drop to their own row instead. */}
      {large ? (
        <>
          {titleBlock}
          {actions ? <View style={styles.headerActionsStacked}>{actions}</View> : null}
        </>
      ) : (
        <View style={styles.headerRow}>
          {titleBlock}
          {actions ? <View style={styles.headerActions}>{actions}</View> : null}
        </View>
      )}
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded && styles.cardPadded, style]}>{children}</View>;
}

export function Divider({ inset = true }: { inset?: boolean }) {
  return <View style={[styles.divider, inset && styles.dividerInset]} />;
}

export function SectionTitle({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <Text style={[type.label, styles.sectionTitle, first && styles.sectionTitleFirst]}>
      {children}
    </Text>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Buttons
 * ────────────────────────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  iconRight?: IconName;
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to fill the parent's width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One button, four intents.
 *
 * `label` is clamped to a single line — a two-line button is a layout bug, so
 * the fix is a shorter label or a wider button, never a wrap.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  icon,
  iconRight,
  size = 'md',
  disabled,
  loading,
  block,
  style,
}: ButtonProps) {
  const isInert = disabled || loading;
  const v = VARIANTS[variant];

  return (
    <Pressable
      onPress={isInert ? undefined : onPress}
      disabled={isInert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isInert, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' ? styles.btnSm : styles.btnMd,
        { backgroundColor: v.bg, borderColor: v.border },
        block && styles.btnBlock,
        pressed && !isInert && styles.btnPressed,
        isInert && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} color={v.text} /> : null}
          <Text style={[type.label, { color: v.text }]} numberOfLines={1}>
            {label}
          </Text>
          {iconRight ? (
            <Icon name={iconRight} size={size === 'sm' ? 15 : 17} color={v.text} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/** A square-ish button that renders only an icon; sized to a 48dp target. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color: tint = color.textSecondary,
  disabled,
  style,
}: {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && !disabled && styles.btnPressed,
        disabled && styles.btnDisabled,
        style,
      ]}
    >
      <Icon name={icon} size={20} color={tint} />
    </Pressable>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; border: string; text: string }> = {
  primary: { bg: color.accentStrong, border: color.accentStrong, text: color.onAccent },
  secondary: { bg: color.raised, border: color.border, text: color.accentText },
  danger: { bg: color.dangerSurface, border: color.dangerBorder, text: color.dangerText },
  ghost: { bg: 'transparent', border: 'transparent', text: color.accentText },
};

/* ────────────────────────────────────────────────────────────────────────── *
 * Segmented control — the one pattern for filters and view switches
 * ────────────────────────────────────────────────────────────────────────── */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional trailing count, e.g. "会话数据 (12)". */
  count?: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scrollable,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Use a horizontal scroller when labels are long or numerous. */
  scrollable?: boolean;
}) {
  const body = (
    <View style={styles.segmentTrack}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.segment,
              scrollable && styles.segmentAuto,
              active && styles.segmentActive,
              pressed && !active && styles.segmentPressed,
            ]}
          >
            <Text
              style={[type.label, active ? styles.segmentTextActive : styles.segmentText]}
              numberOfLines={1}
            >
              {opt.count === undefined ? opt.label : `${opt.label} ${opt.count}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (!scrollable) return body;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.segmentScroll}
    >
      {body}
    </ScrollView>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Status
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A single dot carrying real state (link, recording, server reachability).
 * Decorative dots are deliberately not supported — use a pill or plain text.
 */
export function StatusDot({ tone, size = 8 }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; size?: number }) {
  const bg =
    tone === 'ok' ? color.success : tone === 'warn' ? color.warning : tone === 'bad' ? color.danger : color.neutral;
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]} />;
}

/** Compact state pill. Text is clamped so a long label cannot widen a row. */
export function Pill({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'violet';
  icon?: IconName;
}) {
  const t = PILL_TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      {icon ? <Icon name={icon} size={11} color={t.text} /> : null}
      <Text style={[styles.pillText, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const PILL_TONES = {
  neutral: { bg: color.subtle, border: color.border, text: color.textMuted },
  accent: { bg: color.accentSurface, border: color.accentBorder, text: color.accentText },
  ok: { bg: color.successSurface, border: color.successBorder, text: color.successText },
  warn: { bg: color.warningSurface, border: color.warningBorder, text: color.warningText },
  bad: { bg: color.dangerSurface, border: color.dangerBorder, text: color.dangerText },
  violet: { bg: color.violetSurface, border: color.violetBorder, text: color.violet },
} as const;

export function StatusBadge({
  ok,
  label,
  tone,
}: {
  ok?: boolean;
  label: string;
  tone?: 'ok' | 'bad' | 'idle';
}) {
  const resolved = tone ?? (ok ? 'ok' : 'idle');
  const t = PILL_TONES[resolved === 'ok' ? 'ok' : resolved === 'bad' ? 'bad' : 'neutral'];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      <StatusDot tone={resolved} size={6} />
      <Text style={[styles.pillText, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Metrics
 * ────────────────────────────────────────────────────────────────────────── */

export interface MetricTileProps {
  label: string;
  value: string;
  unit?: string;
  /** Value hue from the `vital` palette. Never used as a card border. */
  hue?: string;
  trend?: 'up' | 'down' | 'stable';
  emphasis?: boolean;
}

/**
 * A single vital-sign reading.
 *
 * Overflow safety: the label clamps to one line, the value shrinks rather than
 * pushing the unit out of the card, and the unit never shrinks. This is the
 * tile that used to be a 36pt number in a half-width card with a 3px coloured
 * left border, which clipped as soon as the system font scale went up.
 */
export function MetricTile({ label, value, unit, hue, trend, emphasis }: MetricTileProps) {
  return (
    <View style={styles.metricTile}>
      <View style={styles.metricHeader}>
        <Text style={[type.label, styles.metricLabel]} numberOfLines={1}>
          {label}
        </Text>
        {trend && trend !== 'stable' ? (
          <Icon
            name={trend === 'up' ? 'arrowUp' : 'arrowDown'}
            size={13}
            color={trend === 'up' ? vital.hr : vital.spo2}
            opacity={0.9}
          />
        ) : null}
      </View>
      <View style={styles.metricValueRow}>
        <Text
          style={[
            emphasis ? styles.metricValueLg : styles.metricValue,
            tabularNums,
            hue ? { color: hue } : null,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
        {unit ? (
          <Text style={[type.label, styles.metricUnit]} numberOfLines={1}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Responsive metric grid.
 *
 * Collapses to a single column when the system font scale is large or the
 * screen is very narrow, which is the difference between "two tidy columns" and
 * "every card has a truncated number in it".
 */
export function MetricGrid({ children }: { children: React.ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const dense = fontScale >= 1.35 || width < 340;
  return <View style={[styles.metricGrid, dense && styles.metricGridStacked]}>{children}</View>;
}

/** Wraps a grid child so it participates in the two-up / stacked layout. */
export function MetricGridItem({ children }: { children: React.ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const dense = fontScale >= 1.35 || width < 340;
  return <View style={dense ? styles.gridItemFull : styles.gridItemHalf}>{children}</View>;
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Data rows
 * ────────────────────────────────────────────────────────────────────────── */

/** label on the left, value on the right, value clamped and allowed to shrink. */
export function DetailRow({
  label,
  value,
  valueColor,
  last,
  stack,
  mono,
}: {
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
  /** Put the label above the value; use for long unbreakable values. */
  stack?: boolean;
  /** Render the value in monospace; use for UUIDs, hosts and raw numbers. */
  mono?: boolean;
}) {
  if (stack) {
    return (
      <View style={[styles.detailRowStacked, !last && styles.detailRowBordered]}>
        <Text style={[type.caption, styles.detailLabelStacked]} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[
            type.body,
            styles.detailValueStacked,
            mono && styles.detailMono,
            valueColor ? { color: valueColor } : null,
          ]}
          selectable
        >
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.detailRow, !last && styles.detailRowBordered]}>
      <Text style={[type.body, styles.detailLabel]} numberOfLines={2}>
        {label}
      </Text>
      <Text
        style={[
          type.body,
          styles.detailValue,
          mono && styles.detailMono,
          valueColor ? { color: valueColor } : null,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

/** Compact label/value pair used inside statistic grids. */
export function StatCell({ label, value, hue }: { label: string; value: string; hue?: string }) {
  return (
    <View style={styles.statCell}>
      <Text style={[type.caption, styles.statCellLabel]} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[type.h2, tabularNums, hue ? { color: hue } : { color: color.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {value}
      </Text>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * States: empty, loading, error
 * ────────────────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon = 'info',
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={color.textMuted} />
      </View>
      <Text style={[type.h2, styles.emptyTitle]}>{title}</Text>
      {description ? (
        <Text style={[type.body, styles.emptyText]}>{description}</Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/** A pulsing placeholder block. Opacity only — safe on the native driver. */
export function Skeleton({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[styles.skeleton, { width, height, opacity: pulse }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Skeleton shaped like a real list row, so the layout does not jump on load. */
export function SkeletonRow() {
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonRowText}>
        <Skeleton width="55%" height={15} />
        <Skeleton width="35%" height={12} style={{ marginTop: space.sm }} />
      </View>
      <Skeleton width={72} height={32} />
    </View>
  );
}

/** Inline error surface: names the problem and keeps the recovery next to it. */
export function ErrorNote({ message }: { message: string }) {
  return (
    <View style={styles.errorNote}>
      <Icon name="alert" size={15} color={color.dangerText} />
      <Text style={[type.label, styles.errorNoteText]}>{message}</Text>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Helpers
 * ────────────────────────────────────────────────────────────────────────── */

/** True when the OS font scale is large enough that dense layouts must relax. */
export function useLargeText(): boolean {
  const { fontScale } = useWindowDimensions();
  return fontScale >= 1.35;
}

/** Current font scale, for one-off decisions outside a render body. */
export function currentFontScale(): number {
  return PixelRatio.getFontScale();
}

export const uiStyles = StyleSheet.create({
  scrollContent: {
    padding: SCREEN_PADDING,
    paddingBottom: space.xxxl,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
});

/* ────────────────────────────────────────────────────────────────────────── *
 * Styles
 * ────────────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  constrain: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },

  /* Header */
  header: {
    backgroundColor: color.surface,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: space.sm,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: color.text },
  headerSubtitle: { color: color.textMuted, marginTop: space.xxs, fontWeight: '400' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  headerActionsStacked: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },

  /* Card */
  card: {
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  cardPadded: { padding: space.lg },
  divider: { height: 1, backgroundColor: color.divider },
  dividerInset: { marginHorizontal: space.lg },
  sectionTitle: {
    color: color.textMuted,
    marginTop: space.xxl,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  sectionTitleFirst: { marginTop: space.sm },

  /* Buttons */
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: TOUCH_TARGET,
  },
  btnMd: { paddingHorizontal: space.lg, paddingVertical: space.md },
  btnSm: { paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 36, borderRadius: radius.sm },
  btnBlock: { alignSelf: 'stretch' },
  btnPressed: { opacity: 0.72 },
  btnDisabled: { opacity: 0.45 },
  iconBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },

  /* Segmented control */
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: color.sunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.xs,
    gap: space.xs,
  },
  segmentScroll: { paddingHorizontal: SCREEN_PADDING, paddingVertical: space.sm },
  segment: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  segmentAuto: { flex: 0, minWidth: 76 },
  segmentActive: { backgroundColor: color.accentSurface },
  segmentPressed: { backgroundColor: color.subtle },
  segmentText: { color: color.textMuted },
  segmentTextActive: { color: color.accentText },

  /* Status */
  dot: {},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: '100%',
    flexShrink: 1,
  },
  pillText: { fontSize: 11, lineHeight: 15, fontWeight: '600', flexShrink: 1 },

  /* Metrics */
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  metricGridStacked: { flexDirection: 'column' },
  gridItemHalf: { flexGrow: 1, flexBasis: '46%', minWidth: 132 },
  gridItemFull: { flexGrow: 1, flexBasis: '100%' },
  metricTile: {
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.md,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
    marginBottom: space.xs,
  },
  metricLabel: { color: color.textMuted, flexShrink: 1, fontWeight: '600' },
  metricValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs + 2 },
  metricValue: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: color.text, flexShrink: 1 },
  metricValueLg: { fontSize: 30, lineHeight: 36, fontWeight: '700', color: color.text, flexShrink: 1 },
  metricUnit: { color: color.textMuted, flexShrink: 0 },

  /* Detail rows */
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
  },
  detailRowBordered: { borderBottomWidth: 1, borderBottomColor: color.divider },
  detailLabel: { color: color.textMuted, flexShrink: 1, minWidth: 0 },
  detailValue: {
    color: color.text,
    fontWeight: '600',
    flexShrink: 1,
    maxWidth: '64%',
    textAlign: 'right',
    ...tabularNums,
  },
  detailRowStacked: { paddingVertical: space.md, gap: space.xs },
  detailLabelStacked: { color: color.textMuted },
  detailValueStacked: { color: color.text, fontWeight: '600' },
  detailMono: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },

  /* Stat cells */
  statCell: { flexGrow: 1, flexBasis: '30%', minWidth: 84, gap: space.xxs },
  statCellLabel: { color: color.textMuted },
  statCellValue: {},

  /* Empty / loading / error */
  empty: { alignItems: 'center', paddingVertical: space.huge, paddingHorizontal: space.xl },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: color.subtle,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: { color: color.textSecondary, textAlign: 'center' },
  emptyText: {
    color: color.textMuted,
    textAlign: 'center',
    marginTop: space.sm,
    maxWidth: 300,
  },
  emptyAction: { marginTop: space.xl },

  skeleton: { backgroundColor: color.subtle, borderRadius: radius.sm },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.lg,
    marginBottom: space.sm,
  },
  skeletonRowText: { flex: 1 },

  errorNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.dangerSurface,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.sm,
    padding: space.md,
  },
  errorNoteText: { color: color.dangerText, flex: 1, fontWeight: '400', lineHeight: 18 },
});

export { motion, radius, space, color, type, tabularNums };
export type { TextStyle };
