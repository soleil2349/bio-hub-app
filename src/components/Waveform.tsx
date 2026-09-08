/**
 * Real-time waveform display component using react-native-svg.
 * Renders a scrolling polyline with grid background.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Rect } from 'react-native-svg';

interface WaveformProps {
  data: number[];
  width: number;
  height: number;
  color: string;
  label?: string;
  unit?: string;
  showGrid?: boolean;
  signed?: boolean;
}

export default function Waveform({
  data,
  width,
  height,
  color,
  label,
  unit,
  showGrid = true,
  signed = false,
}: WaveformProps) {
  const points = useMemo(() => {
    if (data.length < 2) return '';

    let minVal: number, maxVal: number;
    if (signed) {
      const absMax = Math.max(...data.map(Math.abs), 1);
      minVal = -absMax;
      maxVal = absMax;
    } else {
      minVal = Math.min(...data);
      maxVal = Math.max(...data);
      if (maxVal === minVal) {
        maxVal = minVal + 1;
      }
    }

    const padding = 4;
    const range = maxVal - minVal;
    const pointSpacing = width / Math.max(data.length - 1, 1);

    return data
      .map((val, i) => {
        const x = i * pointSpacing;
        const y = padding + ((maxVal - val) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [data, width, height, signed]);

  const gridLines = useMemo(() => {
    if (!showGrid) return [];
    const lines: { y: number }[] = [];
    const count = 4;
    for (let i = 0; i <= count; i++) {
      lines.push({ y: (height / count) * i });
    }
    return lines;
  }, [height, showGrid]);

  return (
    <View style={[styles.container, { width, height: height + (label ? 28 : 0) }]}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {unit && <Text style={styles.unit}>{unit}</Text>}
        </View>
      )}
      <View style={[styles.svgWrapper, { width, height }]}>
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} fill="#0F172A" rx={4} />
          {gridLines.map((line, i) => (
            <Line
              key={i}
              x1={0}
              y1={line.y}
              x2={width}
              y2={line.y}
              stroke="#1E293B"
              strokeWidth={0.5}
            />
          ))}
          {signed && (
            <Line
              x1={0}
              y1={height / 2}
              x2={width}
              y2={height / 2}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="4,4"
            />
          )}
          {points.length > 0 && (
            <Polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )}
        </Svg>
        {data.length < 2 && (
          <View style={styles.emptyOverlay}>
            <Text style={styles.emptyText}>等待数据...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  unit: {
    fontSize: 11,
    color: '#6B7280',
  },
  svgWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#4B5563',
    fontSize: 13,
  },
});
