/**
 * Cloud service screen — upload sessions, view reports, configure server.
 *
 * Works in two modes:
 *   1. Online: uploads data to configured server, fetches AI analysis reports
 *   2. Offline: generates local analysis reports from stored data
 *
 * Layout notes
 * ------------
 *  - Session rows and report details put long text next to fixed badges without
 *    `flexShrink`, so a long device name or a long status message pushed the
 *    badge outside the card. Both sides now negotiate width explicitly.
 *  - The report modal was `<Modal visible>` with no `onRequestClose`, so the
 *    Android hardware back button did nothing while it was open. It now closes.
 *  - The server-config sheet sits on a `KeyboardAvoidingView`: with the URL
 *    keyboard open the save button used to be covered by it.
 *  - Full-screen spinners became skeleton rows shaped like the content, so the
 *    list no longer jumps when data arrives.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { bioHubAPI, ServerStatus, AnalysisReport, UploadRecord } from '../api';
import { Session, getAllSessions } from '../storage';
import { formatTime, formatDuration } from '../analysis';
import { authStore, AuthUser } from '../auth';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  DetailRow,
  EmptyState,
  Pill,
  Screen,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SkeletonRow,
  StatusDot,
} from '../components/ui';
import { color, radius, space, tabularNums, type, vital } from '../theme';

type ViewMode = 'sessions' | 'reports';

interface Props {
  /** 未登录时点击提示条回调，由 App 切换到登录页 */
  onRequireLogin?: () => void;
}

const VIEW_OPTIONS = [
  { value: 'sessions' as const, label: '会话数据' },
  { value: 'reports' as const, label: '分析报告' },
];

/** Health-score hue, shared by the list badge and the report header. */
function scoreHue(score: number): string {
  return score >= 80 ? color.success : score >= 60 ? color.warning : color.danger;
}

function statusHue(status: string): string {
  return status === 'normal' ? color.success : status === 'warning' ? color.warning : color.danger;
}

export default function CloudScreen({ onRequireLogin }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [reports, setReports] = useState<AnalysisReport[]>([]);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(null);
  const [user, setUser] = useState<AuthUser | null>(authStore.getUser());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await bioHubAPI.init();
      setServerUrl(bioHubAPI.getConfig().baseUrl);
      setSessions(await getAllSessions());

      if (bioHubAPI.isConfigured()) {
        const result = await bioHubAPI.getReports();
        if (result.ok && result.reports) setReports(result.reports);
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

  useEffect(() => {
    const unsub = authStore.subscribe((s) => setUser(s?.user ?? null));
    return unsub;
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    try {
      setServerStatus(await bioHubAPI.checkServer());
    } finally {
      setChecking(false);
    }
  };

  const saveConfig = async () => {
    await bioHubAPI.setConfig({ baseUrl: serverUrl.trim() });
    setShowConfig(false);
    Alert.alert('已保存', '服务器地址已更新');
    checkConnection();
  };

  const handleUpload = async (session: Session) => {
    if (!bioHubAPI.isConfigured()) {
      Alert.alert('未配置服务器', '请先配置服务器地址', [
        { text: '取消' },
        { text: '去配置', onPress: () => setShowConfig(true) },
      ]);
      return;
    }

    setUploadingId(session.id);
    try {
      const result = await bioHubAPI.uploadSession(session);
      if (result.success) {
        Alert.alert('上传成功', `${result.message}\n报告编号：${result.reportId || '无'}`);
        loadData();
      } else {
        Alert.alert('上传失败', result.message);
      }
    } finally {
      setUploadingId(null);
    }
  };

  const handleLocalAnalysis = async (session: Session) => {
    const report = await bioHubAPI.generateLocalReport(session.id);
    if (report) {
      setSelectedReport(report);
    } else {
      Alert.alert('分析失败', '无法生成本地分析报告，可能该会话没有有效数据');
    }
  };

  /* ─── Render Helpers ─── */

  const getUploadState = (sessionId: number): UploadRecord | undefined =>
    bioHubAPI.getUploadRecord(sessionId);

  const renderSessionItem = ({ item }: { item: Session }) => {
    const upload = getUploadState(item.id);
    const isUploading = uploadingId === item.id;
    const duration = item.endTime
      ? formatDuration((item.endTime - item.startTime) / 1000)
      : '进行中';

    return (
      <Card padded={false} style={styles.sessionCard}>
        <View style={styles.sessionBody}>
          <View style={styles.sessionTitleRow}>
            <Text style={[type.h2, styles.sessionName]} numberOfLines={1} ellipsizeMode="middle">
              {item.deviceName}
            </Text>
            <Pill
              label={item.connectionType}
              tone={item.connectionType === 'SLE' ? 'violet' : 'accent'}
            />
          </View>

          <Text style={[type.label, styles.sessionTime]} numberOfLines={1}>
            {formatTime(item.startTime)}
          </Text>

          <View style={styles.sessionMetaRow}>
            <Text style={[type.caption, styles.sessionMeta]} numberOfLines={1}>
              {duration} · {item.packetCount} 个数据包
            </Text>
            {upload?.state === 'success' ? (
              <View style={styles.uploadedTag}>
                <Icon name="check" size={12} color={color.successText} />
                <Text style={[type.caption, styles.uploadedText]} numberOfLines={1}>
                  已上传
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.sessionActions}>
          {isUploading ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color={color.accent} size="small" />
              <Text style={[type.label, styles.uploadingText]}>上传中…</Text>
            </View>
          ) : (
            <>
              <Button
                label="本地分析"
                icon="barChart"
                size="sm"
                style={styles.sessionActionBtn}
                onPress={() => handleLocalAnalysis(item)}
              />
              <Button
                label={upload?.state === 'success' ? '重新上传' : '上传'}
                icon="upload"
                size="sm"
                variant="primary"
                style={styles.sessionActionBtn}
                onPress={() => handleUpload(item)}
              />
            </>
          )}
        </View>
      </Card>
    );
  };

  const renderReportItem = ({ item }: { item: AnalysisReport }) => {
    const hue = scoreHue(item.healthScore);

    return (
      <Pressable
        onPress={() => setSelectedReport(item)}
        style={({ pressed }) => [pressed && styles.reportPressed]}
        accessibilityRole="button"
      >
        <Card style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <View style={[styles.scoreBadge, { borderColor: hue, backgroundColor: hue + '1A' }]}>
              <Text
                style={[styles.scoreText, tabularNums, { color: hue }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {item.healthScore}
              </Text>
            </View>
            <View style={styles.reportInfo}>
              <Text style={[type.h2, styles.reportTitle]} numberOfLines={1}>
                分析报告
              </Text>
              <Text style={[type.label, styles.reportTime]} numberOfLines={1}>
                {formatTime(item.createdAt)}
              </Text>
              <View style={styles.reportStatusRow}>
                <StatusDot
                  tone={
                    item.status === 'completed'
                      ? 'ok'
                      : item.status === 'processing'
                      ? 'warn'
                      : 'bad'
                  }
                  size={6}
                />
                <Text style={[type.caption, styles.reportStatusText]} numberOfLines={1}>
                  {item.status === 'completed'
                    ? '已完成'
                    : item.status === 'processing'
                    ? '分析中'
                    : item.status === 'pending'
                    ? '等待中'
                    : '失败'}
                </Text>
              </View>
            </View>
            <Icon name="chevronRight" size={18} color={color.textMuted} />
          </View>
          <Text style={[type.body, styles.reportSummary]} numberOfLines={3}>
            {item.summary}
          </Text>
        </Card>
      </Pressable>
    );
  };

  /** Shared card for one analysed vital: title, state pill, mean and range. */
  const renderVitalDetail = (
    title: string,
    v: { avg: number; min: number; max: number; status: string; message: string },
    hue: string,
  ) => (
    <Card style={styles.detailCard}>
      <View style={styles.detailHeader}>
        <Text style={[type.h2, styles.detailTitle]} numberOfLines={1}>
          {title}
        </Text>
        <Pill label={v.message} tone={v.status === 'normal' ? 'ok' : v.status === 'warning' ? 'warn' : 'bad'} />
      </View>
      <DetailRow label="均值" value={String(v.avg || '--')} valueColor={hue} />
      <DetailRow label="范围" value={`${v.min || '--'} ~ ${v.max || '--'}`} last />
    </Card>
  );

  /* ─── Report Detail Modal ─── */

  const renderReportModal = () => {
    if (!selectedReport) return null;
    const r = selectedReport;
    const hue = scoreHue(r.healthScore);

    return (
      <Modal
        visible
        animationType="slide"
        onRequestClose={() => setSelectedReport(null)}
      >
        <Screen edges={['bottom', 'left', 'right']}>
          <ScreenHeader
            title="分析报告"
            subtitle={formatTime(r.createdAt)}
            actions={
              <Button label="关闭" size="sm" onPress={() => setSelectedReport(null)} />
            }
          />

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Card style={styles.scoreCard}>
              <Text
                style={[styles.scoreLarge, tabularNums, { color: hue }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {r.healthScore}
              </Text>
              <Text style={[type.label, styles.scoreSubtitle]}>健康评分</Text>
              <Text style={[type.body, styles.reportSummaryFull]}>{r.summary}</Text>
            </Card>

            <SectionTitle first>详细分析</SectionTitle>

            {renderVitalDetail('心率 (PPG)', r.details.hr, vital.hr)}
            {renderVitalDetail('血氧饱和度', r.details.spo2, vital.spo2)}

            <Card style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={[type.h2, styles.detailTitle]} numberOfLines={1}>
                  心电分析
                </Text>
                <Pill
                  label={r.details.ecg.message}
                  tone={
                    r.details.ecg.status === 'normal'
                      ? 'ok'
                      : r.details.ecg.status === 'warning'
                      ? 'warn'
                      : 'bad'
                  }
                />
              </View>
              <DetailRow label="平均心率" value={`${r.details.ecg.avgHr || '--'} BPM`} valueColor={vital.ecgHr} />
              <DetailRow label="心律状态" value={r.details.ecg.rhythmStatus} />
              <DetailRow label="信号质量" value={r.details.ecg.signalQuality} last />
            </Card>

            <Card style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={[type.h2, styles.detailTitle]} numberOfLines={1}>
                  血压分析
                </Text>
                <Pill
                  label={r.details.bp.message}
                  tone={
                    r.details.bp.status === 'normal'
                      ? 'ok'
                      : r.details.bp.status === 'warning'
                      ? 'warn'
                      : 'bad'
                  }
                />
              </View>
              <DetailRow
                label="收缩压 / 舒张压"
                value={`${r.details.bp.avgSbp || '--'} / ${r.details.bp.avgDbp || '--'} mmHg`}
                valueColor={vital.sbp}
              />
              <DetailRow label="分级" value={r.details.bp.classification} last />
            </Card>

            {renderVitalDetail('体温', r.details.temp, vital.temp)}

            <SectionTitle>健康建议</SectionTitle>
            <Card>
              {r.recommendations.length === 0 ? (
                <Text style={[type.body, styles.noRec]}>本次分析没有额外建议。</Text>
              ) : (
                r.recommendations.map((rec, i) => (
                  <View key={i} style={[styles.recRow, i > 0 && styles.recRowSpaced]}>
                    <View style={styles.recBullet}>
                      <Text style={[type.caption, styles.recBulletText]}>{i + 1}</Text>
                    </View>
                    <Text style={[type.body, styles.recText]}>{rec}</Text>
                  </View>
                ))
              )}
            </Card>

            {r.id.startsWith('local_') ? (
              <View style={styles.localNote}>
                <Icon name="info" size={15} color={color.accentText} />
                <Text style={[type.caption, styles.localNoteText]}>
                  本报告由本地算法生成。将数据上传至服务器可获得更精确的分析。
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </Screen>
      </Modal>
    );
  };

  /* ─── Config Modal ─── */

  const renderConfigModal = () => (
    <Modal
      visible={showConfig}
      animationType="slide"
      transparent
      onRequestClose={() => setShowConfig(false)}
    >
      <KeyboardAvoidingView
        style={styles.configOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.configScroll}
          keyboardShouldPersistTaps="handled"
        >
          <Card style={styles.configPanel}>
            <Text style={[type.h1, styles.configTitle]}>服务器地址</Text>
            <Text style={[type.body, styles.configDesc]}>
              登录后使用 JWT 令牌自动认证，无需 API 密钥。
            </Text>

            <Text style={[type.label, styles.inputLabel]}>地址</Text>
            <TextInput
              style={[type.body, styles.input]}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://156.226.176.22"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="服务器地址"
            />

            {serverStatus ? (
              <View
                style={[
                  styles.statusBanner,
                  {
                    backgroundColor: serverStatus.online ? color.successSurface : color.dangerSurface,
                    borderColor: serverStatus.online ? color.successBorder : color.dangerBorder,
                  },
                ]}
              >
                <StatusDot tone={serverStatus.online ? 'ok' : 'bad'} />
                <Text style={[type.label, styles.statusMessage]} numberOfLines={2}>
                  {serverStatus.message}
                </Text>
                {serverStatus.latencyMs != null ? (
                  <Text style={[type.caption, styles.statusLatency]}>{serverStatus.latencyMs}ms</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.configActions}>
              <Button
                label="测试连接"
                variant="secondary"
                loading={checking}
                style={styles.configBtn}
                onPress={checkConnection}
              />
              <Button
                label="保存"
                variant="primary"
                style={styles.configBtn}
                onPress={saveConfig}
              />
            </View>
            <Button label="取消" variant="ghost" block onPress={() => setShowConfig(false)} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );

  /* ─── Main Render ─── */

  const configured = bioHubAPI.isConfigured();

  return (
    <Screen>
      <ScreenHeader
        title="云服务"
        subtitle="数据上传与分析报告"
        actions={<Button label="配置" size="sm" onPress={() => setShowConfig(true)} />}
      />

      {/* Server reachability: one dot, carrying real state. */}
      <View style={styles.serverBar}>
        <StatusDot
          tone={serverStatus?.online ? 'ok' : configured ? 'warn' : 'idle'}
        />
        <Text style={[type.label, styles.serverText]} numberOfLines={1}>
          {serverStatus?.online
            ? `已连接 · ${serverStatus.latencyMs ?? 0} ms`
            : configured
            ? '服务器未连接'
            : '未配置服务器'}
        </Text>
        {configured ? (
          <Pressable onPress={checkConnection} disabled={checking} hitSlop={10}>
            <Text style={[type.label, styles.refreshText]}>
              {checking ? '检查中…' : '刷新'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* 未登录提示（离线模式）：登录后才可上传与分析 */}
      {!user ? (
        <Pressable
          style={({ pressed }) => [styles.loginBanner, pressed && styles.loginBannerPressed]}
          onPress={onRequireLogin}
          accessibilityRole="button"
        >
          <Icon name="user" size={16} color={color.accentText} />
          <Text style={[type.label, styles.loginBannerText]} numberOfLines={2}>
            未登录（离线模式）· 点此登录后可上传数据与查看报告
          </Text>
          <Icon name="chevronRight" size={16} color={color.accentText} />
        </Pressable>
      ) : null}

      <View style={styles.modeBar}>
        <SegmentedControl
          options={VIEW_OPTIONS.map((o) => ({
            ...o,
            count: o.value === 'sessions' ? sessions.length : reports.length,
          }))}
          value={viewMode}
          onChange={setViewMode}
        />
      </View>

      {loading ? (
        <View style={styles.list}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : viewMode === 'sessions' ? (
        <FlatList
          data={sessions}
          keyExtractor={(s) => String(s.id)}
          renderItem={renderSessionItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListEmptyComponent={
            <EmptyState
              icon="server"
              title="暂无会话"
              description="连接传感器并采集数据后，会话会出现在这里，可上传到服务器获取 AI 分析报告，或直接在本地分析。"
            />
          }
        />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderReportItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListEmptyComponent={
            <EmptyState
              icon="fileText"
              title="暂无报告"
              description={
                configured
                  ? '上传会话数据或使用本地分析即可生成报告。'
                  : '先在右上角「配置」中填写服务器地址，然后上传会话数据以生成报告。'
              }
            />
          }
        />
      )}

      {renderConfigModal()}
      {renderReportModal()}
    </Screen>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  serverBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  serverText: { flex: 1, minWidth: 0, color: color.textSecondary, fontWeight: '400' },
  refreshText: { color: color.accentText },

  loginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.accentSurface,
    borderWidth: 1,
    borderColor: color.accentBorder,
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    marginHorizontal: space.md,
    marginTop: space.md,
  },
  loginBannerPressed: { opacity: 0.75 },
  loginBannerText: { flex: 1, minWidth: 0, color: color.accentText, fontWeight: '400' },

  modeBar: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.sm,
    backgroundColor: color.surface,
  },

  list: { padding: space.md, paddingBottom: space.xxxl, flexGrow: 1 },

  /* Session cards */
  sessionCard: { padding: space.lg, gap: space.md },
  sessionBody: { gap: space.xxs },
  sessionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sessionName: { color: color.text, flexShrink: 1, minWidth: 0 },
  sessionTime: { color: color.textSecondary, fontWeight: '400' },
  sessionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xxs },
  sessionMeta: { color: color.textMuted, flexShrink: 1 },
  uploadedTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 0 },
  uploadedText: { color: color.successText },
  sessionActions: { flexDirection: 'row', gap: space.sm },
  sessionActionBtn: { flex: 1 },
  uploadingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
  },
  uploadingText: { color: color.textMuted, fontWeight: '400' },

  /* Report cards */
  reportPressed: { opacity: 0.75 },
  reportCard: { gap: space.md },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  scoreBadge: {
    minWidth: 52,
    height: 52,
    paddingHorizontal: space.sm,
    borderRadius: 26,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  scoreText: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  reportInfo: { flex: 1, minWidth: 0, gap: space.xxs },
  reportTitle: { color: color.text },
  reportTime: { color: color.textMuted, fontWeight: '400' },
  reportStatusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, marginTop: space.xxs },
  reportStatusText: { color: color.textSecondary },
  reportSummary: { color: color.textSecondary },

  /* Report modal */
  modalBody: { padding: space.md, paddingBottom: space.xxxl },
  scoreCard: { alignItems: 'center', gap: space.xs, paddingVertical: space.xxl },
  scoreLarge: { fontSize: 56, lineHeight: 64, fontWeight: '700' },
  scoreSubtitle: { color: color.textMuted },
  reportSummaryFull: { color: color.textSecondary, textAlign: 'center', marginTop: space.sm },

  detailCard: { marginBottom: space.sm },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.xs,
  },
  detailTitle: { color: color.textSecondary, flexShrink: 1, minWidth: 0 },

  noRec: { color: color.textMuted },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  recRowSpaced: { marginTop: space.md },
  recBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.accentSurface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  recBulletText: { color: color.accentText, fontWeight: '700' },
  recText: { flex: 1, minWidth: 0, color: color.textSecondary },

  localNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: color.subtle,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.md,
    marginTop: space.md,
  },
  localNoteText: { flex: 1, minWidth: 0, color: color.textMuted, lineHeight: 16 },

  /* Config modal */
  configOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)' },
  configScroll: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  configPanel: { gap: space.md, padding: space.xl },
  configTitle: { color: color.text },
  configDesc: { color: color.textMuted },
  inputLabel: { color: color.textSecondary, marginBottom: -space.xs },
  input: {
    backgroundColor: color.sunken,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderStrong,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: color.text,
    minHeight: 48,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusMessage: { flex: 1, minWidth: 0, color: color.textSecondary, fontWeight: '400' },
  statusLatency: { color: color.textMuted, flexShrink: 0 },
  configActions: { flexDirection: 'row', gap: space.sm },
  configBtn: { flex: 1 },
});
