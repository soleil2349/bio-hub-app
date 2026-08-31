import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr, DiscoveryResult } from '../ble-manager';
import { BioPkt } from '../protocol';

interface Props {
  device: Device;
  onDisconnect: () => void;
}

function DataCard({
  label,
  value,
  unit,
  color,
  large,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  large?: boolean;
}) {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={styles.cardLabel}>{label}</Text>
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

export default function DeviceScreen({ device, onDisconnect }: Props) {
  const [data, setData] = useState<BioPkt | null>(null);
  const [paused, setPaused] = useState(false);
  const [pktCount, setPktCount] = useState(0);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(
    bioBleMgr.discoveryInfo,
  );
  const [showDebug, setShowDebug] = useState(true);
  const [debugLines, setDebugLines] = useState<string[]>([...bioBleMgr.debugLog]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDiscovery(bioBleMgr.discoveryInfo);
    setDebugLines([...bioBleMgr.debugLog]);

    cleanupRef.current = bioBleMgr.subscribeToNotifications(
      (pkt) => {
        setData(pkt);
        setPktCount((c) => c + 1);
      },
      (err) => {
        setDebugLines([...bioBleMgr.debugLog]);
        Alert.alert('通知错误', err.message);
      },
    );

    // Refresh debug log after subscribe
    setDebugLines([...bioBleMgr.debugLog]);

    bioBleMgr.startHeartbeatLoop();

    disconnectRef.current = bioBleMgr.onDisconnect(() => {
      Alert.alert('连接断开', '设备已断开连接');
      onDisconnect();
    });

    // Periodically refresh debug log
    const logTimer = setInterval(() => {
      setDebugLines([...bioBleMgr.debugLog]);
    }, 2000);

    return () => {
      cleanupRef.current?.();
      disconnectRef.current?.();
      bioBleMgr.stopHeartbeatLoop();
      clearInterval(logTimer);
    };
  }, [onDisconnect]);

  const handleToggle = async () => {
    try {
      await bioBleMgr.sendToggle();
      setPaused((p) => !p);
    } catch (err: any) {
      Alert.alert('发送失败', err.message);
    }
  };

  const handleDisconnect = async () => {
    await bioBleMgr.disconnect();
    onDisconnect();
  };

  const deviceName = device.localName || device.name || '未知设备';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{deviceName}</Text>
          <Text style={styles.subtitle}>
            已连接 · 收到 {pktCount} 个数据包
            {discovery
              ? ` · ${discovery.method === 'known' ? '已知' : '自动'}UUID`
              : ' · 未发现特征值'}
          </Text>
        </View>
        <TouchableOpacity style={styles.debugToggle} onPress={() => setShowDebug(v => !v)}>
          <Text style={styles.debugToggleText}>{showDebug ? '数据' : '调试'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>断开</Text>
        </TouchableOpacity>
      </View>

      {showDebug ? (
        /* ====== DEBUG PANEL ====== */
        <ScrollView style={styles.body} contentContainerStyle={styles.debugContent}>
          <Text style={styles.debugTitle}>BLE 调试日志</Text>
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
            </>
          ) : (
            <Text style={[styles.debugLine, { color: '#EF4444' }]}>
              未选中任何特征值！
            </Text>
          )}
        </ScrollView>
      ) : (
        /* ====== DATA PANEL ====== */
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View style={styles.statusRow}>
            <StatusBadge ok={!!data?.flags.maxOk} label="PPG传感器" />
            <StatusBadge ok={!!data?.flags.bmdOk} label="ECG传感器" />
            <StatusBadge ok={!!data?.flags.finger} label="手指检测" />
            <StatusBadge ok={!!data?.flags.pttValid} label="PTT有效" />
          </View>

          <View style={styles.heroRow}>
            <DataCard label="心率 (PPG)" value={data != null ? String(data.hr) : '--'} unit="BPM" color="#EF4444" large />
            <DataCard label="心率 (ECG)" value={data != null ? String(data.ecgHr) : '--'} unit="BPM" color="#F97316" large />
          </View>

          <View style={styles.grid}>
            <DataCard label="血氧饱和度" value={data != null ? String(data.spo2) : '--'} unit="%" color="#3B82F6" />
            <DataCard label="设备温度" value={data != null ? data.tempC.toFixed(1) : '--'} unit="°C" color="#10B981" />
            <DataCard label="收缩压" value={data != null ? String(data.sbp) : '--'} unit="mmHg" color="#8B5CF6" />
            <DataCard label="舒张压" value={data != null ? String(data.dbp) : '--'} unit="mmHg" color="#A855F7" />
            <DataCard label="灌注指数" value={data != null ? data.pi.toFixed(1) : '--'} unit="%" color="#14B8A6" />
            <DataCard label="脉搏传导时间" value={data != null ? String(data.pttMs) : '--'} unit="ms" color="#F59E0B" />
            <DataCard label="ECG信号质量" value={data != null ? String(data.ecgSig) : '--'} unit="" color="#6366F1" />
            <DataCard label="IR原始值" value={data != null ? String(data.ir) : '--'} unit="" color="#64748B" />
          </View>

          <View style={styles.ecgRawCard}>
            <Text style={styles.ecgRawLabel}>ECG 原始采样</Text>
            <Text style={styles.ecgRawValue}>{data?.ecgRaw != null ? String(data.ecgRaw) : '--'}</Text>
          </View>

          <View style={styles.controlRow}>
            <TouchableOpacity style={[styles.controlBtn, paused && styles.controlBtnActive]} onPress={handleToggle}>
              <Text style={styles.controlBtnText}>{paused ? '▶ 恢复采集' : '⏸ 暂停采集'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 48, paddingBottom: 12, paddingHorizontal: 16,
    backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1F2937',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#E0E7FF' },
  subtitle: { fontSize: 11, color: '#6B7280', marginTop: 2 },
  debugToggle: {
    backgroundColor: '#1E3A5F', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, marginRight: 8,
  },
  debugToggleText: { color: '#93C5FD', fontWeight: '600', fontSize: 12 },
  disconnectBtn: {
    backgroundColor: '#7F1D1D', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  disconnectText: { color: '#FCA5A5', fontWeight: '600', fontSize: 13 },
  body: { flex: 1 },
  bodyContent: { padding: 12, paddingBottom: 40 },
  debugContent: { padding: 12, paddingBottom: 40 },

  /* Debug styles */
  debugTitle: { fontSize: 14, fontWeight: '700', color: '#F59E0B', marginBottom: 6 },
  debugLine: { fontSize: 11, color: '#D1D5DB', fontFamily: 'monospace', lineHeight: 16, marginBottom: 1 },
  debugSvc: { marginBottom: 8 },
  debugSvcUuid: { fontSize: 11, color: '#60A5FA', fontFamily: 'monospace', fontWeight: '700' },
  debugCharLine: { fontSize: 10, color: '#9CA3AF', fontFamily: 'monospace', lineHeight: 14 },

  /* Data panel styles */
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  badgeOk: { backgroundColor: '#052E16', borderColor: '#166534' },
  badgeOff: { backgroundColor: '#1C1917', borderColor: '#44403C' },
  badgeDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  dotOk: { backgroundColor: '#4ADE80' },
  dotOff: { backgroundColor: '#78716C' },
  badgeText: { fontSize: 12, color: '#D1D5DB' },
  heroRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { flex: 1, minWidth: '45%', backgroundColor: '#1F2937', borderRadius: 12, padding: 14, borderLeftWidth: 3 },
  cardLabel: { fontSize: 12, color: '#9CA3AF', marginBottom: 4 },
  cardValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  cardValue: { fontSize: 24, fontWeight: '700' },
  cardValueLarge: { fontSize: 36, fontWeight: '800' },
  cardUnit: { fontSize: 13, color: '#6B7280', marginLeft: 4 },
  ecgRawCard: { backgroundColor: '#1F2937', borderRadius: 12, padding: 16, marginTop: 8, alignItems: 'center' },
  ecgRawLabel: { fontSize: 13, color: '#9CA3AF', marginBottom: 4 },
  ecgRawValue: { fontSize: 20, fontWeight: '700', color: '#818CF8', fontFamily: 'monospace' },
  controlRow: { marginTop: 20, alignItems: 'center' },
  controlBtn: { backgroundColor: '#1E3A5F', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#2563EB', minWidth: 200, alignItems: 'center' },
  controlBtnActive: { backgroundColor: '#14532D', borderColor: '#22C55E' },
  controlBtnText: { color: '#E0E7FF', fontSize: 16, fontWeight: '700' },
});
