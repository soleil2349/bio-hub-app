/**
 * Cloud service screen — upload sessions, view reports, configure server.
 *
 * Works in two modes:
 *   1. Online: uploads data to configured server, fetches AI analysis reports
 *   2. Offline: generates local analysis reports from stored data
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
  TextInput,
  Modal,
} from 'react-native';
import {
  bioHubAPI,
  ServerStatus,
  AnalysisReport,
  UploadRecord,
} from '../api';
import { Session, getAllSessions } from '../storage';
import { formatTime, formatDuration } from '../analysis';

type ViewMode = 'sessions' | 'reports';

export default function CloudScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reports, setReports] = useState<AnalysisReport[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await bioHubAPI.init();
      const config = bioHubAPI.getConfig();
      setServerUrl(config.baseUrl);
      setApiKey(config.apiKey);

      const allSessions = await getAllSessions();
      setSessions(allSessions);

      if (bioHubAPI.isConfigured()) {
        const result = await bioHubAPI.getReports();
        if (result.ok && result.reports) {
          setReports(result.reports);
        }
      }
    } catch (err) {
      console.warn('Load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const checkConnection = async () => {
    setChecking(true);
    const status = await bioHubAPI.checkServer();
    setServerStatus(status);
    setChecking(false);
  };

  const saveConfig = async () => {
    await bioHubAPI.setConfig({ baseUrl: serverUrl.trim(), apiKey: apiKey.trim() });
    setShowConfig(false);
    Alert.alert('已保存', '服务器配置已更新');
    checkConnection();
  };

  const handleUpload = async (session: Session) => {
    if (!bioHubAPI.isConfigured()) {
      Alert.alert('未配置服务器', '请先在设置中配置服务器地址', [
        { text: '取消' },
        { text: '去配置', onPress: () => setShowConfig(true) },
      ]);
      return;
    }

    setUploadingId(session.id);
    const result = await bioHubAPI.uploadSession(session);
    setUploadingId(null);

    if (result.success) {
      Alert.alert('上传成功', `${result.message}\n报告ID: ${result.reportId || '无'}`);
      loadData();
    } else {
      Alert.alert('上传失败', result.message);
    }
  };

  const handleLocalAnalysis = async (session: Session) => {
    const report = await bioHubAPI.generateLocalReport(session.id);
    if (report) {
      setSelectedReport(report);
    } else {
      Alert.alert('分析失败', '无法生成本地分析报告，可能无有效数据');
    }
  };

  const handleViewReport = async (reportId: string) => {
    if (bioHubAPI.isConfigured()) {
      const result = await bioHubAPI.getReport(reportId);
      if (result.ok && result.report) {
        setSelectedReport(result.report);
        return;
      }
    }
    Alert.alert('获取失败', '无法获取报告详情');
  };

  /* ─── Render Helpers ─── */

  const getUploadState = (sessionId: number): UploadRecord | undefined => {
    return bioHubAPI.getUploadRecord(sessionId);
  };

  const renderSessionItem = ({ item }: { item: Session }) => {
    const upload = getUploadState(item.id);
    const isUploading = uploadingId === item.id;
    const duration = item.endTime
      ? formatDuration((item.endTime - item.startTime) / 1000)
      : '进行中';

    return (
      <View style={styles.sessionCard}>
        <View style={styles.sessionInfo}>
          <View style={styles.sessionRow}>
            <Text style={styles.sessionName}>{item.deviceName}</Text>
            <View
              style={[
                styles.connBadge,
                item.connectionType === 'SLE' ? styles.connBadgeSLE : styles.connBadgeBLE,
              ]}
            >
              <Text style={styles.connBadgeText}>{item.connectionType}</Text>
            </View>
          </View>
          <Text style={styles.sessionTime}>{formatTime(item.startTime)}</Text>
          <Text style={styles.sessionMeta}>{duration} · {item.packetCount} 数据包</Text>
          {upload?.state === 'success' && (
            <Text style={styles.uploadedLabel}>
              已上传 · {upload.uploadedAt ? formatTime(upload.uploadedAt) : ''}
            </Text>
          )}
        </View>
        <View style={styles.sessionActions}>
          {isUploading ? (
            <ActivityIndicator color="#4A90D9" />
          ) : (
            <>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => handleLocalAnalysis(item)}
              >
                <Text style={styles.actionBtnText}>本地分析</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.uploadBtn]}
                onPress={() => handleUpload(item)}
              >
                <Text style={styles.uploadBtnText}>
                  {upload?.state === 'success' ? '重新上传' : '上传'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderReportItem = ({ item }: { item: AnalysisReport }) => {
    const scoreColor =
      item.healthScore >= 80 ? '#4ADE80' :
      item.healthScore >= 60 ? '#FBBF24' : '#EF4444';

    return (
      <TouchableOpacity
        style={styles.reportCard}
        onPress={() => setSelectedReport(item)}
      >
        <View style={styles.reportHeader}>
          <View style={[styles.scoreBadge, { backgroundColor: scoreColor + '20', borderColor: scoreColor }]}>
            <Text style={[styles.scoreText, { color: scoreColor }]}>{item.healthScore}</Text>
            <Text style={[styles.scoreLabel, { color: scoreColor }]}>分</Text>
          </View>
          <View style={styles.reportInfo}>
            <Text style={styles.reportTitle}>分析报告</Text>
            <Text style={styles.reportTime}>{formatTime(item.createdAt)}</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, {
                backgroundColor: item.status === 'completed' ? '#4ADE80' :
                  item.status === 'processing' ? '#FBBF24' : '#EF4444'
              }]} />
              <Text style={styles.statusText}>
                {item.status === 'completed' ? '已完成' :
                 item.status === 'processing' ? '分析中' :
                 item.status === 'pending' ? '等待中' : '失败'}
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.reportSummary} numberOfLines={2}>{item.summary}</Text>
      </TouchableOpacity>
    );
  };

  /* ─── Report Detail Modal ─── */

  const renderReportModal = () => {
    if (!selectedReport) return null;

    const r = selectedReport;
    const scoreColor =
      r.healthScore >= 80 ? '#4ADE80' :
      r.healthScore >= 60 ? '#FBBF24' : '#EF4444';

    const statusColors: Record<string, string> = {
      normal: '#4ADE80',
      warning: '#FBBF24',
      critical: '#EF4444',
    };

    return (
      <Modal visible animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>分析报告</Text>
            <TouchableOpacity
              style={styles.modalClose}
              onPress={() => setSelectedReport(null)}
            >
              <Text style={styles.modalCloseText}>关闭</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={[1]}
            keyExtractor={() => 'report'}
            renderItem={() => (
              <View style={styles.modalBody}>
                {/* Health Score */}
                <View style={styles.scoreCard}>
                  <Text style={[styles.scoreLarge, { color: scoreColor }]}>{r.healthScore}</Text>
                  <Text style={styles.scoreSubtitle}>健康评分</Text>
                  <Text style={styles.reportSummaryFull}>{r.summary}</Text>
                </View>

                {/* Vital Details */}
                <Text style={styles.sectionTitle}>详细分析</Text>

                {renderVitalDetail('心率 (PPG)', r.details.hr, '#EF4444')}
                {renderVitalDetail('血氧饱和度', r.details.spo2, '#3B82F6')}

                {/* ECG */}
                <View style={styles.detailCard}>
                  <View style={styles.detailHeader}>
                    <Text style={[styles.detailTitle, { color: '#F97316' }]}>心电分析</Text>
                    <View style={[styles.detailStatusBadge, {
                      backgroundColor: (statusColors[r.details.ecg.status] || '#6B7280') + '20',
                    }]}>
                      <Text style={[styles.detailStatusText, {
                        color: statusColors[r.details.ecg.status] || '#6B7280',
                      }]}>
                        {r.details.ecg.message}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>平均心率</Text>
                    <Text style={styles.detailValue}>{r.details.ecg.avgHr || '--'} BPM</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>心律状态</Text>
                    <Text style={styles.detailValue}>{r.details.ecg.rhythmStatus}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>信号质量</Text>
                    <Text style={styles.detailValue}>{r.details.ecg.signalQuality}</Text>
                  </View>
                </View>

                {/* Blood Pressure */}
                <View style={styles.detailCard}>
                  <View style={styles.detailHeader}>
                    <Text style={[styles.detailTitle, { color: '#8B5CF6' }]}>血压分析</Text>
                    <View style={[styles.detailStatusBadge, {
                      backgroundColor: (statusColors[r.details.bp.status] || '#6B7280') + '20',
                    }]}>
                      <Text style={[styles.detailStatusText, {
                        color: statusColors[r.details.bp.status] || '#6B7280',
                      }]}>
                        {r.details.bp.message}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>收缩压 / 舒张压</Text>
                    <Text style={styles.detailValue}>
                      {r.details.bp.avgSbp || '--'} / {r.details.bp.avgDbp || '--'} mmHg
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>分级</Text>
                    <Text style={styles.detailValue}>{r.details.bp.classification}</Text>
                  </View>
                </View>

                {renderVitalDetail('体温', r.details.temp, '#10B981')}

                {/* Recommendations */}
                <Text style={styles.sectionTitle}>健康建议</Text>
                <View style={styles.recCard}>
                  {r.recommendations.map((rec, i) => (
                    <View key={i} style={styles.recRow}>
                      <Text style={styles.recBullet}>{i + 1}</Text>
                      <Text style={styles.recText}>{rec}</Text>
                    </View>
                  ))}
                </View>

                {r.id.startsWith('local_') && (
                  <View style={styles.localNote}>
                    <Text style={styles.localNoteText}>
                      本报告由本地算法生成。上传数据至服务器可获取更精准的 AI 分析。
                    </Text>
                  </View>
                )}
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    );
  };

  const renderVitalDetail = (
    title: string,
    vital: { avg: number; min: number; max: number; status: string; message: string },
    color: string,
  ) => {
    const statusColors: Record<string, string> = {
      normal: '#4ADE80', warning: '#FBBF24', critical: '#EF4444',
    };
    return (
      <View style={styles.detailCard}>
        <View style={styles.detailHeader}>
          <Text style={[styles.detailTitle, { color }]}>{title}</Text>
          <View style={[styles.detailStatusBadge, {
            backgroundColor: (statusColors[vital.status] || '#6B7280') + '20',
          }]}>
            <Text style={[styles.detailStatusText, {
              color: statusColors[vital.status] || '#6B7280',
            }]}>
              {vital.message}
            </Text>
          </View>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>均值</Text>
          <Text style={[styles.detailValue, { color }]}>{vital.avg || '--'}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>范围</Text>
          <Text style={styles.detailValue}>{vital.min || '--'} ~ {vital.max || '--'}</Text>
        </View>
      </View>
    );
  };

  /* ─── Config Modal ─── */

  const renderConfigModal = () => (
    <Modal visible={showConfig} animationType="slide" transparent>
      <View style={styles.configOverlay}>
        <View style={styles.configPanel}>
          <Text style={styles.configTitle}>服务器配置</Text>

          <Text style={styles.inputLabel}>服务器地址</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://api.example.com"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.inputLabel}>API 密钥 (可选)</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="your-api-key"
            placeholderTextColor="#4B5563"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          {serverStatus && (
            <View style={[styles.statusBanner, {
              backgroundColor: serverStatus.online ? '#052E16' : '#450A0A',
              borderColor: serverStatus.online ? '#166534' : '#7F1D1D',
            }]}>
              <View style={[styles.statusIndicator, {
                backgroundColor: serverStatus.online ? '#4ADE80' : '#EF4444',
              }]} />
              <Text style={styles.statusMessage}>{serverStatus.message}</Text>
              {serverStatus.latencyMs != null && (
                <Text style={styles.statusLatency}>{serverStatus.latencyMs}ms</Text>
              )}
            </View>
          )}

          <View style={styles.configActions}>
            <TouchableOpacity
              style={[styles.configBtn, styles.configBtnSecondary]}
              onPress={checkConnection}
              disabled={checking}
            >
              {checking ? (
                <ActivityIndicator color="#93C5FD" size="small" />
              ) : (
                <Text style={styles.configBtnSecondaryText}>测试连接</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.configBtn, styles.configBtnPrimary]}
              onPress={saveConfig}
            >
              <Text style={styles.configBtnPrimaryText}>保存</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.configCancel}
            onPress={() => setShowConfig(false)}
          >
            <Text style={styles.configCancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  /* ─── Main Render ─── */

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>云服务</Text>
          <Text style={styles.subtitle}>数据上传与分析报告</Text>
        </View>
        <TouchableOpacity style={styles.configToggle} onPress={() => setShowConfig(true)}>
          <Text style={styles.configToggleText}>配置</Text>
        </TouchableOpacity>
      </View>

      {/* Server Status Bar */}
      <View style={styles.serverBar}>
        <View style={[styles.serverDot, {
          backgroundColor: serverStatus?.online ? '#4ADE80' :
            bioHubAPI.isConfigured() ? '#FBBF24' : '#6B7280',
        }]} />
        <Text style={styles.serverText}>
          {serverStatus?.online
            ? `已连接 (${serverStatus.latencyMs}ms)`
            : bioHubAPI.isConfigured()
              ? '未连接'
              : '未配置服务器'}
        </Text>
        {bioHubAPI.isConfigured() && (
          <TouchableOpacity onPress={checkConnection} disabled={checking}>
            <Text style={styles.refreshText}>{checking ? '检查中...' : '刷新'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* View Mode Toggle */}
      <View style={styles.modeBar}>
        <TouchableOpacity
          style={[styles.modeTab, viewMode === 'sessions' && styles.modeTabActive]}
          onPress={() => setViewMode('sessions')}
        >
          <Text style={[styles.modeTabText, viewMode === 'sessions' && styles.modeTabTextActive]}>
            会话数据 ({sessions.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeTab, viewMode === 'reports' && styles.modeTabActive]}
          onPress={() => setViewMode('reports')}
        >
          <Text style={[styles.modeTabText, viewMode === 'reports' && styles.modeTabTextActive]}>
            分析报告 ({reports.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#4A90D9" size="large" />
        </View>
      ) : viewMode === 'sessions' ? (
        <FlatList
          data={sessions}
          keyExtractor={(s) => String(s.id)}
          renderItem={renderSessionItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>暂无会话</Text>
              <Text style={styles.emptyText}>连接设备采集数据后将在此显示</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderReportItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>暂无报告</Text>
              <Text style={styles.emptyText}>
                上传会话数据或使用本地分析生成报告
              </Text>
            </View>
          }
        />
      )}

      {renderConfigModal()}
      {renderReportModal()}
    </SafeAreaView>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#111827',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#E0E7FF' },
  subtitle: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  configToggle: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  configToggleText: { color: '#93C5FD', fontWeight: '600', fontSize: 13 },

  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    gap: 8,
  },
  serverDot: { width: 8, height: 8, borderRadius: 4 },
  serverText: { flex: 1, fontSize: 12, color: '#9CA3AF' },
  refreshText: { color: '#60A5FA', fontSize: 12, fontWeight: '600' },

  modeBar: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#1F2937',
  },
  modeTabActive: { backgroundColor: '#1E3A5F' },
  modeTabText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  modeTabTextActive: { color: '#93C5FD' },

  list: { padding: 12, paddingBottom: 100 },

  /* Session Cards */
  sessionCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  sessionInfo: { marginBottom: 10 },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionName: { fontSize: 15, fontWeight: '700', color: '#E5E7EB' },
  connBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  connBadgeBLE: { backgroundColor: '#1E3A5F' },
  connBadgeSLE: { backgroundColor: '#3B1F5E' },
  connBadgeText: { fontSize: 9, fontWeight: '800', color: '#C4B5FD' },
  sessionTime: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  sessionMeta: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  uploadedLabel: { fontSize: 11, color: '#4ADE80', marginTop: 4 },
  sessionActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  actionBtnText: { color: '#93C5FD', fontSize: 13, fontWeight: '600' },
  uploadBtn: { backgroundColor: '#1E3A5F', borderColor: '#2563EB' },
  uploadBtnText: { color: '#60A5FA', fontSize: 13, fontWeight: '600' },

  /* Report Cards */
  reportCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  scoreBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: { fontSize: 20, fontWeight: '800' },
  scoreLabel: { fontSize: 9, fontWeight: '600', marginTop: -2 },
  reportInfo: { flex: 1 },
  reportTitle: { fontSize: 15, fontWeight: '700', color: '#E5E7EB' },
  reportTime: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, color: '#9CA3AF' },
  reportSummary: { fontSize: 13, color: '#D1D5DB', lineHeight: 20 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#6B7280', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#4B5563', textAlign: 'center' },

  /* Config Modal */
  configOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  configPanel: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#374151',
  },
  configTitle: { fontSize: 20, fontWeight: '800', color: '#E0E7FF', marginBottom: 20 },
  inputLabel: { fontSize: 13, color: '#9CA3AF', marginBottom: 6, fontWeight: '600' },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#E5E7EB',
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
  },
  statusIndicator: { width: 8, height: 8, borderRadius: 4 },
  statusMessage: { flex: 1, fontSize: 13, color: '#D1D5DB' },
  statusLatency: { fontSize: 12, color: '#9CA3AF' },
  configActions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  configBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  configBtnSecondary: { backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#374151' },
  configBtnSecondaryText: { color: '#93C5FD', fontWeight: '600', fontSize: 14 },
  configBtnPrimary: { backgroundColor: '#2563EB' },
  configBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  configCancel: { alignItems: 'center', paddingVertical: 8 },
  configCancelText: { color: '#6B7280', fontSize: 14 },

  /* Report Modal */
  modalContainer: { flex: 1, backgroundColor: '#0A0E1A' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#E0E7FF' },
  modalClose: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCloseText: { color: '#93C5FD', fontWeight: '600', fontSize: 13 },
  modalBody: { padding: 16, paddingBottom: 40 },

  scoreCard: {
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  scoreLarge: { fontSize: 56, fontWeight: '800' },
  scoreSubtitle: { fontSize: 14, color: '#9CA3AF', marginTop: -4 },
  reportSummaryFull: {
    fontSize: 14,
    color: '#D1D5DB',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 22,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#E0E7FF',
    marginBottom: 10,
    marginTop: 4,
  },

  detailCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  detailTitle: { fontSize: 14, fontWeight: '700' },
  detailStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  detailStatusText: { fontSize: 11, fontWeight: '700' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: { fontSize: 13, color: '#9CA3AF' },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#E5E7EB' },

  recCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 16,
  },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  recBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1E3A5F',
    textAlign: 'center',
    lineHeight: 22,
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  recText: { flex: 1, fontSize: 14, color: '#D1D5DB', lineHeight: 22 },

  localNote: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  localNoteText: { fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});
