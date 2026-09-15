/**
 * Connected device screen with multi-tab view:
 *   - Live vitals dashboard
 *   - Waveform/trend display
 *   - Statistical analysis
 *   - BLE/SLE debug panel
 *
 * Automatically records session data to SQLite when connected.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
  Dimensions,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr, DiscoveryResult } from '../ble-manager';
import {
  BioPkt,
  ConnectionType,
  LED_MODE_AUTO,
  LED_MODE_ON,
  LED_MODE_OFF,
  LED_MODE_BLINK,
  LED_MODE_LABELS,
} from '../protocol';
import { LiveAnalyzer, LiveStats, formatDuration } from '../analysis';
import { createSession, endSession, queueMeasurement, flushPending, isReady } from '../storage';
import Waveform from '../components/Waveform';
import TabBar from '../components/TabBar';

const SCREEN_WIDTH = Dimensions.get('window').width;
const WAVEFORM_WIDTH = SCREEN_WIDTH - 32;

interface Props {
  device: Device;
  onDisconnect: () => void;
  autoRecord?: boolean;
}

type DeviceTab = 'live' | 'wave' | 'stats' | 'debug';

/* ─── Reusable Sub-Components ─── */

function DataCard({
  label,
  value,
  unit,
  color,
  large,
  trend,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  large?: boolean;
  trend?: 'up' | 'down' | 'stable';
}) {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{label}</Text>
        {trend && trend !== 'stable' && (
          <Text style={{ color: trend === 'up' ? '#EF4444' : '#3B82F6', fontSize: 12 }}>
            {trend === 'up' ? '\u2191' : '\u2193'}
          </Text>
        )}
      </View>
      <View style={styles.cardValueRow}>
        <Text
          style={[
            large ? styles.cardValueLarge : styles.cardValue,
            { color },
          ]}
        >
          {value}
        </Text>
        <Text style={styles.cardUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={[styles.badge, ok ? styles.badgeOk : styles.badgeOff]}>
      <View style={[styles.badgeDot, ok ? styles.dotOk : styles.dotOff]} />
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function StatRow({
  label,
  avg,
  min,
  max,
  unit,
  color,
}: {
  label: string;
  avg: number;
  min: number;
  max: number;
  unit: string;
  color: string;
}) {
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
      <View style={styles.statValues}>
        <View style={styles.statCell}>
          <Text style={styles.statCellLabel}>均值</Text>
          <Text style={[styles.statCellValue, { color }]}>{avg || '--'}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statCellLabel}>最小</Text>
          <Text style={styles.statCellValue}>{min || '--'}</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.statCellLabel}>最大</Text>
          <Text style={styles.statCellValue}>{max || '--'}</Text>
        </View>
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
    </View>
  );
}

/* ─── Display Value Merging ─── */

type DisplayValues = {
  hr: string; ecgHr: string; spo2: string; tempC: string;
  sbp: string; dbp: string; pi: string; pttMs: string;
  ecgSig: string; ir: string; ecgRaw: string; rrMs: string;
};

const EMPTY_DISPLAY: DisplayValues = {
  hr: '--', ecgHr: '--', spo2: '--', tempC: '--',
  sbp: '--', dbp: '--', pi: '--', pttMs: '--',
  ecgSig: '--', ir: '--', ecgRaw: '--', rrMs: '--',
};

function mergeDisplay(prev: DisplayValues, pkt: BioPkt): DisplayValues {
  return {
    hr:     pkt.hr     ? String(pkt.hr)            : prev.hr,
    ecgHr:  pkt.ecgHr  ? String(pkt.ecgHr)         : prev.ecgHr,
    spo2:   pkt.spo2   ? String(pkt.spo2)          : prev.spo2,
    tempC:  pkt.tempC  ? pkt.tempC.toFixed(1)       : prev.tempC,
    sbp:    pkt.sbp    ? String(pkt.sbp)            : prev.sbp,
    dbp:    pkt.dbp    ? String(pkt.dbp)            : prev.dbp,
    pi:     pkt.pi     ? pkt.pi.toFixed(1)          : prev.pi,
    pttMs:  pkt.pttMs  ? String(pkt.pttMs)          : prev.pttMs,
    ecgSig: String(pkt.ecgSig),
    ir:     pkt.ir     ? String(pkt.ir)             : prev.ir,
    ecgRaw: String(pkt.ecgRaw),
    rrMs:   pkt.rrMs   ? String(pkt.rrMs)           : prev.rrMs,
  };
}

/* ─── Main Component ─── */

export default function DeviceScreen({ device, onDisconnect, autoRecord = true }: Props) {
  const [data, setData] = useState<BioPkt | null>(null);
  const [display, setDisplay] = useState<DisplayValues>(EMPTY_DISPLAY);
  const [paused, setPaused] = useState(false);
  /** V3：板载 LED 模式（LED_MODE_AUTO/ON/OFF/BLINK）*/
  const [ledMode, setLedMode] = useState<number>(LED_MODE_AUTO);
  const [pktCount, setPktCount] = useState(0);
  const [activeTab, setActiveTab] = useState<DeviceTab>('live');
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [ecgWave, setEcgWave] = useState<number[]>([]);
  const [hrWave, setHrWave] = useState<number[]>([]);
  const [spo2Wave, setSpo2Wave] = useState<number[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(
    bioBleMgr.discoveryInfo,
  );
  const [debugLines, setDebugLines] = useState<string[]>([...bioBleMgr.debugLog]);
  const [connType, setConnType] = useState<ConnectionType>(
    bioBleMgr.getConnectionType(),
  );

  const cleanupRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const analyzerRef = useRef(new LiveAnalyzer());
  const sessionIdRef = useRef<number | null>(null);

  const startRecording = useCallback(async () => {
    if (!isReady()) return;
    try {
      const name = device.localName || device.name || 'Unknown';
      const type = bioBleMgr.getConnectionType();
      const id = await createSession(name, device.id, type);
      sessionIdRef.current = id;
      setSessionId(id);
      setRecording(true);
    } catch (err) {
      console.warn('Failed to start recording:', err);
    }
  }, [device]);

  const stopRecording = useCallback(async () => {
    if (sessionIdRef.current) {
      await flushPending();
      await endSession(sessionIdRef.current);
      sessionIdRef.current = null;
      setSessionId(null);
      setRecording(false);
    }
  }, []);

  useEffect(() => {
    setDiscovery(bioBleMgr.discoveryInfo);
    setConnType(bioBleMgr.getConnectionType());
    setDebugLines([...bioBleMgr.debugLog]);
    analyzerRef.current.reset();

    if (autoRecord) {
      startRecording();
    }

    cleanupRef.current = bioBleMgr.subscribeToNotifications(
      (pkt) => {
        setData(pkt);
        setDisplay((prev) => mergeDisplay(prev, pkt));
        setPktCount((c) => c + 1);

        analyzerRef.current.addPacket(pkt);

        if (sessionIdRef.current) {
          queueMeasurement(sessionIdRef.current, pkt);
        }
      },
      (err) => {
        setDebugLines([...bioBleMgr.debugLog]);
        Alert.alert('通知错误', err.message);
      },
    );

    setDebugLines([...bioBleMgr.debugLog]);
    bioBleMgr.startHeartbeatLoop();

    disconnectRef.current = bioBleMgr.onDisconnect(() => {
      stopRecording();
      Alert.alert('连接断开', '设备已断开连接');
      onDisconnect();
    });

    const updateTimer = setInterval(() => {
      setDebugLines([...bioBleMgr.debugLog]);
      setLiveStats(analyzerRef.current.getStats());
      setEcgWave(analyzerRef.current.getEcgWaveform());
      setHrWave(analyzerRef.current.getHrTrend());
      setSpo2Wave(analyzerRef.current.getSpo2Trend());
    }, 1000);

    return () => {
      cleanupRef.current?.();
      disconnectRef.current?.();
      bioBleMgr.stopHeartbeatLoop();
      clearInterval(updateTimer);
      stopRecording();
    };
  }, [onDisconnect, autoRecord, startRecording, stopRecording]);

  const handleToggle = async () => {
    try {
      await bioBleMgr.sendToggle();
      setPaused((p) => !p);
    } catch (err: any) {
      Alert.alert('发送失败', err.message);
    }
  };

  const handleDisconnect = async () => {
    await stopRecording();
    await bioBleMgr.disconnect();
    onDisconnect();
  };

  /* V3：板载 LED 模式控制（自动 → 常亮 → 常灭 → 快闪 循环切换）*/
  const handleCycleLed = async () => {
    const order = [LED_MODE_AUTO, LED_MODE_ON, LED_MODE_OFF, LED_MODE_BLINK];
    const idx = order.indexOf(ledMode);
    const next = order[(idx + 1) % order.length];
    try {
      await bioBleMgr.sendSetLed(next);
      setLedMode(next);
    } catch (err: any) {
      Alert.alert('发送失败', err.message);
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const deviceName = device.localName || device.name || '未知设备';
  const connTypeLabel = connType === 'SLE' ? 'SLE' : connType === 'BLE' ? 'BLE' : 'AUTO';

  /* ─── Tab Content Renderers ─── */

  const renderLiveTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <View style={styles.statusRow}>
        <StatusBadge ok={!!data?.flags.maxOk} label="PPG传感器" />
        <StatusBadge ok={!!data?.flags.bmdOk} label="ECG传感器" />
        <StatusBadge ok={!!data?.flags.finger} label="手指检测" />
        <StatusBadge ok={!!data?.flags.pttValid} label="PTT有效" />
      </View>

      {/* V3：设备侧链路与指示灯状态（来自 bio_pkt_t.status 第 21 字节）
          旧固件（20 字节包）无此字段 → devStatus 为 undefined，自动隐藏 */}
      {data?.devStatus && (
        <View style={styles.statusRow}>
          <StatusBadge ok={data.devStatus.sleConn} label="星闪SLE" />
          <StatusBadge ok={data.devStatus.bleConn} label="蓝牙BLE" />
          <StatusBadge ok={data.devStatus.ledOn} label="板载LED" />
          <StatusBadge ok={!data.devStatus.ledManual} label="LED自动" />
        </View>
      )}

      <View style={styles.heroRow}>
        <DataCard
          label="心率 (PPG)"
          value={display.hr}
          unit="BPM"
          color="#EF4444"
          large
          trend={liveStats?.hrTrend}
        />
        <DataCard
          label="心率 (ECG)"
          value={display.ecgHr}
          unit="BPM"
          color="#F97316"
          large
        />
      </View>

      <View style={styles.grid}>
        <DataCard label="血氧饱和度" value={display.spo2} unit="%" color="#3B82F6" />
        <DataCard label="设备温度" value={display.tempC} unit="\u00B0C" color="#10B981" />
        <DataCard label="收缩压" value={display.sbp} unit="mmHg" color="#8B5CF6" />
        <DataCard label="舒张压" value={display.dbp} unit="mmHg" color="#A855F7" />
        <DataCard label="灌注指数" value={display.pi} unit="%" color="#14B8A6" />
        <DataCard label="脉搏传导时间" value={display.pttMs} unit="ms" color="#F59E0B" />
        <DataCard label="ECG信号质量" value={display.ecgSig} unit="" color="#6366F1" />
        <DataCard label="IR原始值" value={display.ir} unit="" color="#64748B" />
      </View>

      <View style={styles.extraRow}>
        <View style={styles.extraCard}>
          <Text style={styles.extraLabel}>ECG 原始采样</Text>
          <Text style={styles.extraValue}>{display.ecgRaw}</Text>
        </View>
        <View style={styles.extraCard}>
          <Text style={styles.extraLabel}>R-R 间期</Text>
          <Text style={styles.extraValue}>{display.rrMs} <Text style={styles.extraUnit}>ms</Text></Text>
        </View>
      </View>

      <View style={styles.controlRow}>
        <TouchableOpacity
          style={[styles.controlBtn, paused && styles.controlBtnActive]}
          onPress={handleToggle}
        >
          <Text style={styles.controlBtnText}>
            {paused ? '\u25B6 恢复采集' : '\u23F8 暂停采集'}
          </Text>
        </TouchableOpacity>

        {/* V3：板载 LED 模式切换（自动/常亮/常灭/快闪）*/}
        <TouchableOpacity
          style={[styles.controlBtn, ledMode !== LED_MODE_AUTO && styles.controlBtnActive]}
          onPress={handleCycleLed}
        >
          <Text style={styles.controlBtnText}>
            {'\uD83D\uDCA1 '}指示灯: {LED_MODE_LABELS[ledMode] ?? '自动'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderWaveTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <Waveform
        data={ecgWave}
        width={WAVEFORM_WIDTH}
        height={140}
        color="#4ADE80"
        label="ECG 波形"
        unit="raw"
        signed
      />
      <View style={{ height: 16 }} />
      <Waveform
        data={hrWave}
        width={WAVEFORM_WIDTH}
        height={100}
        color="#EF4444"
        label="心率趋势"
        unit="BPM"
      />
      <View style={{ height: 16 }} />
      <Waveform
        data={spo2Wave}
        width={WAVEFORM_WIDTH}
        height={100}
        color="#3B82F6"
        label="血氧趋势"
        unit="%"
      />
      <View style={styles.waveInfo}>
        <Text style={styles.waveInfoText}>
          采样点数: {ecgWave.length} / 200
        </Text>
        <Text style={styles.waveInfoText}>
          更新频率: ~2Hz
        </Text>
      </View>
    </ScrollView>
  );

  const renderStatsTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <View style={styles.sessionInfoCard}>
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>采集时长</Text>
          <Text style={styles.sessionInfoValue}>
            {formatDuration(liveStats?.duration ?? 0)}
          </Text>
        </View>
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>数据量</Text>
          <Text style={styles.sessionInfoValue}>{liveStats?.sampleCount ?? 0} 个有效样本</Text>
        </View>
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>连接方式</Text>
          <Text style={styles.sessionInfoValue}>{connTypeLabel}</Text>
        </View>
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>记录状态</Text>
          <Text style={[styles.sessionInfoValue, { color: recording ? '#4ADE80' : '#F87171' }]}>
            {recording ? '正在记录' : '未记录'}
          </Text>
        </View>
      </View>

      <Text style={styles.statsTitle}>实时统计</Text>

      <View style={styles.statsCard}>
        <StatRow
          label="心率 (PPG)"
          avg={liveStats?.hrAvg ?? 0}
          min={liveStats?.hrMin ?? 0}
          max={liveStats?.hrMax ?? 0}
          unit="BPM"
          color="#EF4444"
        />
        <StatRow
          label="血氧"
          avg={liveStats?.spo2Avg ?? 0}
          min={liveStats?.spo2Min ?? 0}
          max={liveStats?.spo2Max ?? 0}
          unit="%"
          color="#3B82F6"
        />
        <StatRow
          label="心率 (ECG)"
          avg={liveStats?.ecgHrAvg ?? 0}
          min={0}
          max={0}
          unit="BPM"
          color="#F97316"
        />
        <StatRow
          label="血压"
          avg={liveStats?.sbpAvg ?? 0}
          min={liveStats?.dbpAvg ?? 0}
          max={0}
          unit="mmHg"
          color="#8B5CF6"
        />
        <StatRow
          label="温度"
          avg={liveStats?.tempAvg ?? 0}
          min={0}
          max={0}
          unit="\u00B0C"
          color="#10B981"
        />
        <StatRow
          label="灌注指数"
          avg={liveStats?.piAvg ?? 0}
          min={0}
          max={0}
          unit="%"
          color="#14B8A6"
        />
      </View>
    </ScrollView>
  );

  const renderDebugTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <Text style={styles.debugTitle}>BLE/SLE 调试日志</Text>
      {debugLines.map((line, i) => (
        <Text key={i} style={styles.debugLine}>{line}</Text>
      ))}

      <Text style={[styles.debugTitle, { marginTop: 16 }]}>
        发现的服务 ({bioBleMgr.allServices.length})
      </Text>
      {bioBleMgr.allServices.map((svc, si) => (
        <View key={si} style={styles.debugSvc}>
          <Text style={styles.debugSvcUuid}>SVC: {svc.uuid}</Text>
          {svc.chars.map((ch, ci) => (
            <Text key={ci} style={styles.debugCharLine}>
              {'  '}CHR: {ch.uuid} [{ch.props.join(',')}]
            </Text>
          ))}
        </View>
      ))}
      {bioBleMgr.allServices.length === 0 && (
        <Text style={styles.debugLine}>（无服务发现）</Text>
      )}

      <Text style={[styles.debugTitle, { marginTop: 16 }]}>选中的特征值</Text>
      {discovery ? (
        <>
          <Text style={styles.debugLine}>SVC: {discovery.serviceUUID}</Text>
          <Text style={styles.debugLine}>CHR: {discovery.charUUID}</Text>
          <Text style={styles.debugLine}>方式: {discovery.method}</Text>
          <Text style={styles.debugLine}>
            连接类型: {discovery.connectionType === 'SLE' ? 'SLE (NearLink/SparkLink)' : discovery.connectionType === 'BLE' ? 'BLE (Bluetooth)' : '自动发现'}
          </Text>
        </>
      ) : (
        <Text style={[styles.debugLine, { color: '#EF4444' }]}>
          未选中任何特征值！
        </Text>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title} numberOfLines={1}>{deviceName}</Text>
            <View
              style={[
                styles.connBadge,
                connType === 'SLE' ? styles.connBadgeSLE : styles.connBadgeBLE,
              ]}
            >
              <Text style={styles.connBadgeText}>{connTypeLabel}</Text>
            </View>
            {recording && (
              <View style={styles.recBadge}>
                <View style={styles.recDot} />
                <Text style={styles.recText}>REC</Text>
              </View>
            )}
          </View>
          <Text style={styles.subtitle}>
            已连接 · {pktCount} 个数据包
            {liveStats ? ` · ${formatDuration(liveStats.duration)}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.recBtn} onPress={toggleRecording}>
          <Text style={[styles.recBtnText, recording ? { color: '#F87171' } : { color: '#93C5FD' }]}>
            {recording ? '停止' : '记录'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>断开</Text>
        </TouchableOpacity>
      </View>

      {/* ─── Tab Content ─── */}
      {activeTab === 'live' && renderLiveTab()}
      {activeTab === 'wave' && renderWaveTab()}
      {activeTab === 'stats' && renderStatsTab()}
      {activeTab === 'debug' && renderDebugTab()}

      {/* ─── Tab Bar ─── */}
      <TabBar
        tabs={[
          { id: 'live', label: '实时' },
          { id: 'wave', label: '趋势' },
          { id: 'stats', label: '分析' },
          { id: 'debug', label: '调试' },
        ]}
        activeTab={activeTab}
        onSelect={(id) => setActiveTab(id as DeviceTab)}
      />
    </SafeAreaView>
  );
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingBottom: 10,
    paddingHorizontal: 14,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerLeft: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: '#E0E7FF', maxWidth: 140 },
  subtitle: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  connBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  connBadgeBLE: { backgroundColor: '#1E3A5F' },
  connBadgeSLE: { backgroundColor: '#3B1F5E' },
  connBadgeText: { fontSize: 10, fontWeight: '800', color: '#C4B5FD', letterSpacing: 0.5 },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: '#450A0A',
  },
  recDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  recText: { fontSize: 9, fontWeight: '800', color: '#FCA5A5', letterSpacing: 1 },
  recBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  recBtnText: { fontSize: 12, fontWeight: '700' },
  disconnectBtn: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectText: { color: '#FCA5A5', fontWeight: '600', fontSize: 12 },

  /* Tab body */
  tabBody: { flex: 1 },
  tabContent: { padding: 12, paddingBottom: 20 },

  /* Live data */
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeOk: { backgroundColor: '#052E16', borderColor: '#166534' },
  badgeOff: { backgroundColor: '#1C1917', borderColor: '#44403C' },
  badgeDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  dotOk: { backgroundColor: '#4ADE80' },
  dotOff: { backgroundColor: '#78716C' },
  badgeText: { fontSize: 12, color: '#D1D5DB' },
  heroRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  cardValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  cardValue: { fontSize: 24, fontWeight: '700' },
  cardValueLarge: { fontSize: 36, fontWeight: '800' },
  cardUnit: { fontSize: 13, color: '#6B7280', marginLeft: 4 },
  extraRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  extraCard: {
    flex: 1,
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  extraLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  extraValue: { fontSize: 18, fontWeight: '700', color: '#818CF8', fontFamily: 'monospace' },
  extraUnit: { fontSize: 12, color: '#6B7280' },
  controlRow: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  controlBtn: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    minWidth: 150,
    alignItems: 'center',
  },
  controlBtnActive: { backgroundColor: '#14532D', borderColor: '#22C55E' },
  controlBtnText: { color: '#E0E7FF', fontSize: 15, fontWeight: '700' },

  /* Waveform tab */
  waveInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingHorizontal: 4,
  },
  waveInfoText: { fontSize: 11, color: '#6B7280' },

  /* Stats tab */
  sessionInfoCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  sessionInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  sessionInfoLabel: { fontSize: 13, color: '#9CA3AF' },
  sessionInfoValue: { fontSize: 13, color: '#E5E7EB', fontWeight: '600' },
  statsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#E0E7FF',
    marginBottom: 10,
  },
  statsCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  statRow: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  statLabel: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  statValues: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  statCell: { alignItems: 'center' },
  statCellLabel: { fontSize: 10, color: '#6B7280', marginBottom: 2 },
  statCellValue: { fontSize: 16, fontWeight: '700', color: '#D1D5DB' },
  statUnit: { fontSize: 11, color: '#6B7280', marginLeft: 'auto' },

  /* Debug tab */
  debugTitle: { fontSize: 14, fontWeight: '700', color: '#F59E0B', marginBottom: 6 },
  debugLine: {
    fontSize: 11,
    color: '#D1D5DB',
    fontFamily: 'monospace',
    lineHeight: 16,
    marginBottom: 1,
  },
  debugSvc: { marginBottom: 8 },
  debugSvcUuid: {
    fontSize: 11,
    color: '#60A5FA',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  debugCharLine: {
    fontSize: 10,
    color: '#9CA3AF',
    fontFamily: 'monospace',
    lineHeight: 14,
  },
});
