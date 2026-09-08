/**
 * Session history screen — shows past recording sessions with stats.
 * Supports viewing details, exporting CSV, and deleting sessions.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
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

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [stats, setStats] = useState<Record<number, SessionStats>>({});

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllSessions();
      setSessions(data);
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

  const handleExport = async (session: Session) => {
    try {
      const csv = await exportSessionCSV(session.id);
      Alert.alert(
        '导出完成',
        `CSV数据已生成 (${csv.length} 字节)\n\n数据可通过分享功能导出`,
      );
    } catch (err: any) {
      Alert.alert('导出失败', err.message);
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

  const renderStatItem = (label: string, value: string, color: string) => (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );

  const renderSession = ({ item }: { item: Session }) => {
    const isExpanded = expandedId === item.id;
    const sessionStats = stats[item.id];
    const duration = item.endTime
      ? formatDuration((item.endTime - item.startTime) / 1000)
      : '进行中';

    return (
      <TouchableOpacity
        style={[styles.sessionCard, isExpanded && styles.sessionCardExpanded]}
        onPress={() => handleExpand(item)}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.7}
      >
        <View style={styles.sessionHeader}>
          <View style={styles.sessionInfo}>
            <View style={styles.sessionTitleRow}>
              <Text style={styles.sessionName}>{item.deviceName}</Text>
              <View
                style={[
                  styles.typeBadge,
                  item.connectionType === 'SLE' ? styles.typeBadgeSLE : styles.typeBadgeBLE,
                ]}
              >
                <Text style={styles.typeBadgeText}>{item.connectionType}</Text>
              </View>
            </View>
            <Text style={styles.sessionTime}>{formatTime(item.startTime)}</Text>
            <View style={styles.sessionMetaRow}>
              <Text style={styles.sessionMeta}>{duration}</Text>
              <Text style={styles.sessionMetaDot}> · </Text>
              <Text style={styles.sessionMeta}>{item.packetCount} 个数据包</Text>
            </View>
          </View>
          <Text style={styles.expandArrow}>{isExpanded ? '\u25B2' : '\u25BC'}</Text>
        </View>

        {isExpanded && (
          <View style={styles.statsPanel}>
            {sessionStats ? (
              <>
                <View style={styles.statsGrid}>
                  {renderStatItem(
                    '心率 (PPG)',
                    `${sessionStats.hrAvg} (${sessionStats.hrMin}-${sessionStats.hrMax})`,
                    '#EF4444',
                  )}
                  {renderStatItem('心率 (ECG)', `${sessionStats.ecgHrAvg}`, '#F97316')}
                  {renderStatItem(
                    '血氧',
                    `${sessionStats.spo2Avg}% (${sessionStats.spo2Min}-${sessionStats.spo2Max})`,
                    '#3B82F6',
                  )}
                  {renderStatItem('温度', `${sessionStats.tempAvg}\u00B0C`, '#10B981')}
                  {renderStatItem('血压', `${sessionStats.sbpAvg}/${sessionStats.dbpAvg}`, '#8B5CF6')}
                  {renderStatItem('灌注指数', `${sessionStats.piAvg}%`, '#14B8A6')}
                </View>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => handleExport(item)}
                  >
                    <Text style={styles.actionBtnText}>导出 CSV</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnDanger]}
                    onPress={() => handleDelete(item)}
                  >
                    <Text style={[styles.actionBtnText, styles.actionBtnDangerText]}>
                      删除
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <ActivityIndicator color="#4A90D9" style={{ padding: 16 }} />
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>历史记录</Text>
        <Text style={styles.subtitle}>
          共 {sessions.length} 次会话记录
        </Text>
      </View>

      {sessions.length > 0 && (
        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.clearBtn} onPress={handleClearAll}>
            <Text style={styles.clearBtnText}>清除全部</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color="#4A90D9" size="large" />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => String(s.id)}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Text style={styles.emptyTitle}>暂无记录</Text>
              <Text style={styles.emptyText}>
                连接设备后将自动记录传感器数据
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  header: {
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#111827',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#E0E7FF' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  clearBtnText: { color: '#FCA5A5', fontSize: 12, fontWeight: '600' },
  list: { padding: 12, paddingBottom: 100 },
  sessionCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  sessionCardExpanded: { borderColor: '#4A90D9' },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  sessionInfo: { flex: 1 },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionName: { fontSize: 16, fontWeight: '700', color: '#E5E7EB' },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  typeBadgeBLE: { backgroundColor: '#1E3A5F' },
  typeBadgeSLE: { backgroundColor: '#3B1F5E' },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: '#93C5FD' },
  sessionTime: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  sessionMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  sessionMeta: { fontSize: 11, color: '#6B7280' },
  sessionMetaDot: { color: '#4B5563' },
  expandArrow: { color: '#6B7280', fontSize: 12, paddingHorizontal: 8 },
  statsPanel: {
    borderTopWidth: 1,
    borderTopColor: '#374151',
    backgroundColor: '#172135',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
  },
  statItem: {
    width: '47%',
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 10,
  },
  statLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  statValue: { fontSize: 14, fontWeight: '700' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    paddingTop: 0,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#1E3A5F',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  actionBtnText: { color: '#93C5FD', fontSize: 13, fontWeight: '600' },
  actionBtnDanger: {
    backgroundColor: '#2D1515',
    borderColor: '#7F1D1D',
    flex: 0.6,
  },
  actionBtnDangerText: { color: '#FCA5A5' },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#6B7280', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#4B5563', textAlign: 'center', lineHeight: 22 },
});
