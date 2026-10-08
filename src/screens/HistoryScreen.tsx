/**
 * Session history — recorded sessions with statistics, export and cleanup.
 *
 * Layout notes
 * ------------
 *  - Session name used to be an unconstrained child of a row: no `flexShrink`,
 *    no `numberOfLines`, sitting next to a BLE/SLE pill. Any advertised device
 *    name longer than the remaining space pushed the pill off the right edge.
 *    The name now shrinks and clamps; the pill keeps its width.
 *  - The expand affordance was the text characters `▲` / `▼`; it is now the
 *    shared chevron from the icon set, inside a real touch target.
 *  - Expanded statistics used `width: '47%'` boxes. They are now flexible cells
 *    that wrap to two-up or one-up depending on the system font scale.
 *  - "导出 CSV" claimed the data "可通过分享功能导出" but nothing ever shared it.
 *    It now writes the file and opens the system share sheet.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  Session,
  SessionStats,
  getAllSessions,
  getSessionStats,
  deleteSession,
  clearAllData,
  exportSessionCSV,
} from '../storage';
import { formatDuration, formatTime } from '../analysis';
import { bioHubAPI } from '../api';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  ScreenHeader,
  SkeletonRow,
  StatCell,
} from '../components/ui';
import { color, space, type, vital } from '../theme';

/** "2026年9月29日" style day label used to group the list. */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSameDay(d, today)) return '今天';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, yesterday)) return '昨天';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<number, SessionStats>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await getAllSessions());
    } catch (err) {
      console.warn('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleExpand = async (session: Session) => {
    if (expandedId === session.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(session.id);
    if (!stats[session.id]) {
      const s = await getSessionStats(session.id);
      if (s) setStats((prev) => ({ ...prev, [session.id]: s }));
    }
  };

  const handleDelete = (session: Session) => {
    Alert.alert('删除会话', `确定要删除此会话记录吗？\n${formatTime(session.startTime)}`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(session.id);
          await loadSessions();
        },
      },
    ]);
  };

  /** Write the CSV to a cache file, then hand it to the system share sheet. */
  const handleExport = async (session: Session) => {
    setBusyId(session.id);
    try {
      const csv = await exportSessionCSV(session.id);
      const name = `biohub_${session.id}_${new Date(session.startTime)
        .toISOString()
        .slice(0, 19)
        .replace(/[:T]/g, '')}.csv`;

      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: '导出会话数据',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('无法分享', `设备不支持分享功能。文件已生成：\n${file.uri}`);
      }
    } catch (err: any) {
      Alert.alert('导出失败', err?.message ?? '生成 CSV 时出错');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpload = async (session: Session) => {
    if (!bioHubAPI.isConfigured()) {
      Alert.alert('未配置服务器', '请先在「云服务」页面配置服务器地址');
      return;
    }
    setBusyId(session.id);
    try {
      const result = await bioHubAPI.uploadSession(session);
      if (result.success) {
        Alert.alert('上传成功', result.message);
      } else {
        Alert.alert('上传失败', result.message);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleLocalAnalysis = async (session: Session) => {
    setBusyId(session.id);
    try {
      const report = await bioHubAPI.generateLocalReport(session.id);
      if (report) {
        const score = report.healthScore;
        const level = score >= 80 ? '良好' : score >= 60 ? '一般' : '需关注';
        Alert.alert(
          `健康评分 ${score} 分（${level}）`,
          `${report.summary}\n\n${report.recommendations.join('\n')}`,
        );
      } else {
        Alert.alert('分析失败', '无法生成分析报告，可能该会话没有有效数据');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleClearAll = () => {
    Alert.alert('清除所有数据', '确定要删除所有历史记录吗？此操作不可撤销。', [
      { text: '取消', style: 'cancel' },
      {
        text: '全部删除',
        style: 'destructive',
        onPress: async () => {
          await clearAllData();
          await loadSessions();
          setStats({});
        },
      },
    ]);
  };

  /**
   * Sessions arriving newest-first, annotated with a day label that is only
   * rendered when it changes. Grouping by day gives the list a scannable
   * rhythm instead of forty identical rows.
   */
  const rows = useMemo(() => {
    let lastDay: string | null = null;
    return sessions.map((s) => {
      const day = dayLabel(s.startTime);
      const showDay = day !== lastDay;
      lastDay = day;
      return { session: s, day, showDay };
    });
  }, [sessions]);

  const renderSession = ({ item }: { item: { session: Session; day: string; showDay: boolean } }) => {
    const { session, day, showDay } = item;
    const isExpanded = expandedId === session.id;
    const sessionStats = stats[session.id];
    const busy = busyId === session.id;
    const duration = session.endTime
      ? formatDuration((session.endTime - session.startTime) / 1000)
      : '进行中';

    return (
      <View>
        {showDay ? <Text style={styles.dayHeader}>{day}</Text> : null}

        <Card padded={false} style={isExpanded ? styles.cardExpanded : undefined}>
          <Pressable
            onPress={() => handleExpand(session)}
            onLongPress={() => handleDelete(session)}
            style={({ pressed }) => [styles.sessionHeader, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityState={{ expanded: isExpanded }}
            accessibilityLabel={`${session.deviceName}，${formatTime(session.startTime)}`}
          >
            <View style={styles.sessionInfo}>
              <View style={styles.sessionTitleRow}>
                <Text style={[type.h2, styles.sessionName]} numberOfLines={1} ellipsizeMode="middle">
                  {session.deviceName}
                </Text>
                <Pill
                  label={session.connectionType}
                  tone={session.connectionType === 'SLE' ? 'violet' : 'accent'}
                />
              </View>
              <Text style={[type.label, styles.sessionTime]} numberOfLines={1}>
                {formatTime(session.startTime)}
              </Text>
              <Text style={[type.caption, styles.sessionMeta]} numberOfLines={1}>
                {duration} · {session.packetCount} 个数据包
              </Text>
            </View>

            <View style={styles.expandBtn}>
              <Icon
                name={isExpanded ? 'chevronUp' : 'chevronDown'}
                size={18}
                color={color.textMuted}
              />
            </View>
          </Pressable>

          {isExpanded ? (
            <View style={styles.statsPanel}>
              {sessionStats ? (
                <>
                  <View style={styles.statsGrid}>
                    <StatCell
                      label="心率 PPG"
                      value={`${sessionStats.hrAvg}`}
                      hue={vital.hr}
                    />
                    <StatCell label="心率 ECG" value={`${sessionStats.ecgHrAvg}`} hue={vital.ecgHr} />
                    <StatCell label="血氧" value={`${sessionStats.spo2Avg}%`} hue={vital.spo2} />
                    <StatCell label="温度" value={`${sessionStats.tempAvg}°C`} hue={vital.temp} />
                    <StatCell
                      label="血压"
                      value={`${sessionStats.sbpAvg}/${sessionStats.dbpAvg}`}
                      hue={vital.sbp}
                    />
                    <StatCell label="灌注指数" value={`${sessionStats.piAvg}%`} hue={vital.pi} />
                  </View>

                  <Text style={[type.caption, styles.statsRange]}>
                    心率范围 {sessionStats.hrMin} ~ {sessionStats.hrMax} BPM · 血氧范围{' '}
                    {sessionStats.spo2Min} ~ {sessionStats.spo2Max}%
                  </Text>

                  {busy ? (
                    <View style={styles.busyRow}>
                      <ActivityIndicator color={color.accent} size="small" />
                      <Text style={[type.label, styles.busyText]}>处理中…</Text>
                    </View>
                  ) : (
                    <>
                      <View style={styles.actionRow}>
                        <Button
                          label="本地分析"
                          icon="barChart"
                          size="sm"
                          style={styles.actionBtn}
                          onPress={() => handleLocalAnalysis(session)}
                        />
                        <Button
                          label="上传"
                          icon="upload"
                          size="sm"
                          variant="primary"
                          style={styles.actionBtn}
                          onPress={() => handleUpload(session)}
                        />
                      </View>
                      <View style={styles.actionRow}>
                        <Button
                          label="导出 CSV"
                          icon="download"
                          size="sm"
                          style={styles.actionBtn}
                          onPress={() => handleExport(session)}
                        />
                        <Button
                          label="删除"
                          icon="trash"
                          size="sm"
                          variant="danger"
                          style={styles.actionBtn}
                          onPress={() => handleDelete(session)}
                        />
                      </View>
                    </>
                  )}
                </>
              ) : (
                <View style={styles.statsLoading}>
                  <ActivityIndicator color={color.accent} />
                </View>
              )}
            </View>
          ) : null}
        </Card>
      </View>
    );
  };

  return (
    <Screen>
      <ScreenHeader
        title="历史记录"
        subtitle={
          loading
            ? '正在读取本地数据库…'
            : sessions.length === 0
            ? '还没有任何会话记录'
            : `共 ${sessions.length} 次会话`
        }
        actions={
          sessions.length > 0 ? (
            <Button label="清除全部" variant="danger" size="sm" onPress={handleClearAll} />
          ) : undefined
        }
      />

      {loading ? (
        <View style={styles.list}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.session.id)}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListEmptyComponent={
            <EmptyState
              icon="clock"
              title="暂无记录"
              description="连接传感器后会自动开始记录，完成的会话将在这里按日期归档，可展开查看统计、导出 CSV 或上传分析。"
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.md, paddingBottom: space.xxxl, flexGrow: 1 },

  dayHeader: {
    ...type.label,
    color: color.textMuted,
    marginTop: space.sm,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },

  cardExpanded: { borderColor: color.accent },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  rowPressed: { backgroundColor: color.raisedHigh },
  sessionInfo: { flex: 1, minWidth: 0, gap: space.xxs },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sessionName: { color: color.text, flexShrink: 1, minWidth: 0 },
  sessionTime: { color: color.textSecondary, fontWeight: '400' },
  sessionMeta: { color: color.textMuted },
  expandBtn: { width: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  statsPanel: {
    borderTopWidth: 1,
    borderTopColor: color.divider,
    backgroundColor: color.subtle,
    padding: space.md,
    gap: space.md,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  statsRange: { color: color.textMuted, lineHeight: 16 },
  statsLoading: { paddingVertical: space.lg, alignItems: 'center' },

  actionRow: { flexDirection: 'row', gap: space.sm },
  actionBtn: { flex: 1 },

  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.md },
  busyText: { color: color.textMuted, fontWeight: '400' },
});
