/**
 * Real-time waveform plot (react-native-svg).
 *
 * Layout notes
 * ------------
 *  - `width` is supplied by the caller from a measured container, so the plot
 *    can never be wider than its card.
 *  - The label row keeps the title shrinkable and the unit fixed, so a long
 *    localised label cannot push the unit off the edge.
 *  - The waiting state is a centred hint rather than an absolutely positioned
 *    overlay with a low-contrast string (#4B5563 at 1.9:1 was unreadable).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { radius, space, sunkenChrome, type, type Palette } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

export interface WaveformProps {
  data: number[];
  width: number;
  height: number;
  /** Plot stroke colour, normally a vital hue. */
  color: string;
  label?: string;
  unit?: string;
  showGrid?: boolean;
  /** Centre the trace on zero; use for raw bipolar ECG. */
  signed?: boolean;
}

const PAD = 4;
const GRID_DIVISIONS = 4;

export default function Waveform({
  data,
  width,
  height,
  color: stroke,
  label,
  unit,
  showGrid = true,
  signed = false,
}: WaveformProps) {
  const { color } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const points = useMemo(() => {
    if (data.length < 2 || width <= 0) return '';

    let minVal: number;
    let maxVal: number;
    if (signed) {
      const absMax = Math.max(...data.map(Math.abs), 1);
      minVal = -absMax;
      maxVal = absMax;
    } else {
      minVal = Math.min(...data);
      maxVal = Math.max(...data);
      if (maxVal === minVal) maxVal = minVal + 1;
    }

    const range = maxVal - minVal;
    const pointSpacing = width / Math.max(data.length - 1, 1);

    return data
      .map((val, i) => {
        const x = i * pointSpacing;
        const y = PAD + ((maxVal - val) / range) * (height - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [data, width, height, signed]);

  const gridLines = useMemo(() => {
    if (!showGrid) return [];
    return Array.from({ length: GRID_DIVISIONS + 1 }, (_, i) => (height / GRID_DIVISIONS) * i);
  }, [height, showGrid]);

  const isEmpty = data.length < 2;

  return (
    <View style={styles.container}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[type.label, styles.label]} numberOfLines={1}>
            {label}
          </Text>
          {unit ? (
            <Text style={[type.caption, styles.unit]} numberOfLines={1}>
              {unit}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.plot, styles.plotWell, { width, height }]}>
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill={color.sunken} rx={radius.sm} />

          {showGrid
            ? gridLines.map((y, i) => (
                <Line key={i} x1={0} y1={y} x2={width} y2={y} stroke={color.plotGrid} strokeWidth={1} />
              ))
            : null}

          {signed ? (
            <Line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke={color.plotAxis}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          ) : null}

          {points.length > 0 ? (
            <Polyline
              points={points}
              fill="none"
              stroke={stroke}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
        </Svg>

        {isEmpty ? (
          <View style={styles.emptyOverlay} pointerEvents="none">
            <Text style={[type.caption, styles.emptyText]}>等待数据</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(color: Palette) {
  return StyleSheet.create({
  container: { width: '100%' },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.xs + 2,
  },
  label: { color: color.textSecondary, flexShrink: 1, minWidth: 0 },
  unit: { color: color.textMuted, flexShrink: 0 },
  plot: { borderRadius: radius.sm, overflow: 'hidden' },
  plotWell: { ...sunkenChrome(color), backgroundColor: color.sunken },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: { color: color.textMuted },
});
}
