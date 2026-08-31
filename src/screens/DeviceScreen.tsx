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
  const cleanupRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setDiscovery(bioBleMgr.discoveryInfo);

    cleanupRef.current = bioBleMgr.subscribeToNotifications(
      (pkt) => {
        setData(pkt);
        setPktCount((c) => c + 1);
      },
      (err) => Alert.alert('通知错误', err.message),
    );

    bioBleMgr.startHeartbeatLoop();

    disconnectRef.current = bioBleMgr.onDisconnect(() => {
      Alert.alert('连接断开', '设备已断开连接');
      onDisconnect();
    });

    return () => {
      cleanupRef.current?.();
      disconnectRef.current?.();
      bioBleMgr.stopHeartbeatLoop();
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
        <View>
          <Text style={styles.title}>{deviceName}</Text>
          <Text style={styles.subtitle}>
            已连接 · 收到 {pktCount} 个数据包
            {discovery
              ? ` · ${discovery.method === 'known' ? '已知' : '自动发现'}UUID`
              : ' · 未发现特征值'}
          </Text>
          {discovery && (
            <Text style={styles.uuidHint} numberOfLines={1}>
              {discovery.charUUID.substring(0, 8)}...
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>断开</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {/* Status badges */}
        <View style={styles.statusRow}>
          <StatusBadge ok={!!data?.flags.maxOk} label="PPG传感器" />
          <StatusBadge ok={!!data?.flags.bmdOk} label="ECG传感器" />
          <StatusBadge ok={!!data?.flags.finger} label="手指检测" />
          <StatusBadge ok={!!data?.flags.pttValid} label="PTT有效" />
        </View>

        {/* Heart rate - hero card */}
        <View style={styles.heroRow}>
          <DataCard
            label="心率 (PPG)"
            value={data?.hr ? String(data.hr) : '--'}
            unit="BPM"
            color="#EF4444"
            large
          />
          <DataCard
            label="心率 (ECG)"
            value={data?.ecgHr ? String(data.ecgHr) : '--'}
            unit="BPM"
            color="#F97316"
            large
          />
        </View>

        {/* Vital signs grid */}
        <View style={styles.grid}>
          <DataCard
            label="血氧饱和度"
            value={data?.spo2 ? String(data.spo2) : '--'}
            unit="%"
            color="#3B82F6"
          />
          <DataCard
            label="体温"
            value={data?.tempC ? data.tempC.toFixed(1) : '--'}
            unit="°C"
            color="#10B981"
          />
          <DataCard
            label="收缩压"
            value={data?.sbp ? String(data.sbp) : '--'}
            unit="mmHg"
            color="#8B5CF6"
          />
          <DataCard
            label="舒张压"
            value={data?.dbp ? String(data.dbp) : '--'}
            unit="mmHg"
            color="#A855F7"
          />
          <DataCard
            label="灌注指数"
            value={data?.pi != null ? data.pi.toFixed(1) : '--'}
            unit="%"
            color="#14B8A6"
          />
          <DataCard
            label="脉搏传导时间"
            value={data?.pttMs ? String(data.pttMs) : '--'}
            unit="ms"
            color="#F59E0B"
          />
          <DataCard
            label="ECG信号质量"
            value={data?.ecgSig != null ? String(data.ecgSig) : '--'}
            unit=""
            color="#6366F1"
          />
          <DataCard
            label="IR原始值"
            value={data?.ir ? String(data.ir) : '--'}
            unit=""
            color="#64748B"
          />
        </View>

        {/* ECG raw sample */}
        <View style={styles.ecgRawCard}>
          <Text style={styles.ecgRawLabel}>ECG 原始采样</Text>
          <Text style={styles.ecgRawValue}>
            {data?.ecgRaw != null ? String(data.ecgRaw) : '--'}
          </Text>
        </View>

        {/* Control buttons */}
        <View style={styles.controlRow}>
          <TouchableOpacity
            style={[styles.controlBtn, paused && styles.controlBtnActive]}
            onPress={handleToggle}
          >
            <Text style={styles.controlBtnText}>
              {paused ? '▶ 恢复采集' : '⏸ 暂停采集'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E1A',
  },
  header: {
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E0E7FF',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  uuidHint: {
    fontSize: 10,
    color: '#4B5563',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  disconnectBtn: {
    backgroundColor: '#7F1D1D',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disconnectText: {
    color: '#FCA5A5',
    fontWeight: '600',
    fontSize: 13,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 12,
    paddingBottom: 40,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeOk: {
    backgroundColor: '#052E16',
    borderColor: '#166534',
  },
  badgeOff: {
    backgroundColor: '#1C1917',
    borderColor: '#44403C',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  dotOk: {
    backgroundColor: '#4ADE80',
  },
  dotOff: {
    backgroundColor: '#78716C',
  },
  badgeText: {
    fontSize: 12,
    color: '#D1D5DB',
  },
  heroRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    marginBottom: 0,
  },
  cardLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  cardValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  cardValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  cardValueLarge: {
    fontSize: 36,
    fontWeight: '800',
  },
  cardUnit: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 4,
  },
  ecgRawCard: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    alignItems: 'center',
  },
  ecgRawLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  ecgRawValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#818CF8',
    fontFamily: 'monospace',
  },
  controlRow: {
    marginTop: 20,
    alignItems: 'center',
  },
  controlBtn: {
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2563EB',
    minWidth: 200,
    alignItems: 'center',
  },
  controlBtnActive: {
    backgroundColor: '#14532D',
    borderColor: '#22C55E',
  },
  controlBtnText: {
    color: '#E0E7FF',
    fontSize: 16,
    fontWeight: '700',
  },
});
