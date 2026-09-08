/**
 * Device scan screen with BLE + SLE (NearLink) support.
 * Features: connection type badges, signal strength, improved UI.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  Animated,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr } from '../ble-manager';
import { BLE_DEVICE_NAME, SLE_DEVICE_NAME, matchDeviceName, ConnectionType } from '../protocol';

interface Props {
  onConnected: (device: Device) => void;
  scanDuration?: number;
}

type FilterMode = 'all' | 'bio' | 'ble' | 'sle';

function getDeviceType(name: string | null): ConnectionType {
  if (!name) return 'unknown';
  if (name.includes(SLE_DEVICE_NAME)) return 'SLE';
  if (name.includes(BLE_DEVICE_NAME)) return 'BLE';
  return 'unknown';
}

function signalIcon(rssi: number | null): string {
  if (rssi === null) return '\u2581';
  if (rssi > -50) return '\u2581\u2583\u2585\u2587';
  if (rssi > -65) return '\u2581\u2583\u2585';
  if (rssi > -80) return '\u2581\u2583';
  return '\u2581';
}

export default function ScanScreen({ onConnected, scanDuration = 10 }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const devicesRef = useRef<Map<string, Device>>(new Map());
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (scanning) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [scanning, pulseAnim]);

  const startScan = useCallback(async () => {
    const ok = await bioBleMgr.requestPermissions();
    if (!ok) {
      Alert.alert('权限不足', '需要蓝牙和位置权限才能扫描设备');
      return;
    }

    await bioBleMgr.waitForPoweredOn();

    devicesRef.current.clear();
    setDevices([]);
    setScanning(true);

    bioBleMgr.startScan(
      (device) => {
        if (!device.name && !device.localName) return;
        devicesRef.current.set(device.id, device);
        const sorted = [...devicesRef.current.values()].sort((a, b) => {
          const aName = a.localName || a.name || '';
          const bName = b.localName || b.name || '';
          const aMatch = matchDeviceName(aName);
          const bMatch = matchDeviceName(bName);
          const aScore = aMatch.isMatch ? 0 : 1;
          const bScore = bMatch.isMatch ? 0 : 1;
          if (aScore !== bScore) return aScore - bScore;
          return (b.rssi ?? -100) - (a.rssi ?? -100);
        });
        setDevices(sorted);
      },
      (err) => {
        console.warn('Scan error:', err);
        setScanning(false);
      },
    );

    setTimeout(() => {
      bioBleMgr.stopScan();
      setScanning(false);
    }, scanDuration * 1000);
  }, [scanDuration]);

  useEffect(() => {
    startScan();
    return () => bioBleMgr.stopScan();
  }, [startScan]);

  const filteredDevices = devices.filter((d) => {
    if (filter === 'all') return true;
    const name = d.localName || d.name || '';
    const match = matchDeviceName(name);
    if (filter === 'bio') return match.isMatch;
    if (filter === 'ble') return match.isMatch && match.expectedType === 'BLE';
    if (filter === 'sle') return match.isMatch && match.expectedType === 'SLE';
    return true;
  });

  const handleConnect = async (device: Device) => {
    bioBleMgr.stopScan();
    setScanning(false);
    setConnecting(device.id);

    try {
      const connected = await bioBleMgr.connect(device);
      onConnected(connected);
    } catch (err: any) {
      Alert.alert('连接失败', err.message || '无法连接到设备');
      setConnecting(null);
    }
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const name = item.localName || item.name || '未知设备';
    const match = matchDeviceName(name);
    const isConnecting = connecting === item.id;
    const devType = getDeviceType(name);

    return (
      <TouchableOpacity
        style={[styles.deviceCard, match.isMatch && styles.deviceCardHighlight]}
        onPress={() => handleConnect(item)}
        disabled={isConnecting}
        activeOpacity={0.7}
      >
        <View style={styles.deviceInfo}>
          <View style={styles.deviceTitleRow}>
            <Text style={[styles.deviceName, match.isMatch && styles.deviceNameHighlight]}>
              {name}
            </Text>
            {match.isMatch && (
              <View
                style={[
                  styles.typeBadge,
                  devType === 'SLE' ? styles.typeBadgeSLE : styles.typeBadgeBLE,
                ]}
              >
                <Text style={styles.typeBadgeText}>
                  {devType === 'SLE' ? 'SLE' : 'BLE'}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.deviceId}>{item.id}</Text>
          <View style={styles.deviceMetaRow}>
            <Text style={styles.signalBars}>{signalIcon(item.rssi)}</Text>
            <Text style={styles.deviceRssi}>
              {item.rssi ?? '?'} dBm
            </Text>
          </View>
        </View>
        {isConnecting ? (
          <ActivityIndicator color="#4A90D9" />
        ) : (
          <View style={[styles.connectBtnBox, match.isMatch && styles.connectBtnBoxHighlight]}>
            <Text style={[styles.connectBtn, match.isMatch && styles.connectBtnHighlight]}>
              连接
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTextRow}>
          <Text style={styles.title}>BIO HUB</Text>
          <Animated.View style={[styles.liveDot, scanning && { opacity: pulseAnim }]}>
            <View style={[styles.liveDotInner, scanning ? styles.liveDotOn : styles.liveDotOff]} />
          </Animated.View>
        </View>
        <Text style={styles.subtitle}>生物传感器助手 · BLE + NearLink</Text>
      </View>

      <View style={styles.filterBar}>
        {(['all', 'bio', 'ble', 'sle'] as FilterMode[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f === 'all' ? '全部' : f === 'bio' ? 'BIO HUB' : f.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.scanBar}>
        <Text style={styles.scanStatus}>
          {scanning
            ? '正在扫描附近设备...'
            : `找到 ${filteredDevices.length} 个设备`}
        </Text>
        <TouchableOpacity
          style={[styles.scanBtn, scanning && styles.scanBtnScanning]}
          onPress={startScan}
          disabled={scanning}
        >
          {scanning ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.scanBtnText}>重新扫描</Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredDevices}
        keyExtractor={(d) => d.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{scanning ? '\u26A1' : '\u2728'}</Text>
            <Text style={styles.emptyTitle}>
              {scanning ? '正在搜索设备' : '未发现设备'}
            </Text>
            <Text style={styles.emptyText}>
              {scanning
                ? '正在搜索附近的 BLE 和星闪设备...'
                : '请确保设备已开机并在附近，然后点击重新扫描'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E1A',
  },
  header: {
    paddingTop: 48,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#111827',
  },
  headerTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#E0E7FF',
    letterSpacing: 2,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveDotOn: { backgroundColor: '#4ADE80' },
  liveDotOff: { backgroundColor: '#6B7280' },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    gap: 6,
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  filterTabActive: {
    backgroundColor: '#1E3A5F',
    borderColor: '#2563EB',
  },
  filterTabText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  filterTabTextActive: {
    color: '#93C5FD',
  },
  scanBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  scanStatus: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  scanBtn: {
    backgroundColor: '#4A90D9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  scanBtnScanning: {
    backgroundColor: '#374151',
  },
  scanBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  list: {
    padding: 12,
    paddingBottom: 100,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  deviceCardHighlight: {
    borderColor: '#4A90D9',
    backgroundColor: '#172554',
  },
  deviceInfo: {
    flex: 1,
  },
  deviceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  deviceNameHighlight: {
    color: '#93C5FD',
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  typeBadgeBLE: {
    backgroundColor: '#1E3A5F',
  },
  typeBadgeSLE: {
    backgroundColor: '#3B1F5E',
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#C4B5FD',
    letterSpacing: 0.5,
  },
  deviceId: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 3,
    fontFamily: 'monospace',
  },
  deviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  signalBars: {
    fontSize: 10,
    color: '#4ADE80',
    letterSpacing: 1,
  },
  deviceRssi: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  connectBtnBox: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  connectBtnBoxHighlight: {
    borderColor: '#2563EB',
    backgroundColor: '#1E3A5F',
  },
  connectBtn: {
    color: '#4A90D9',
    fontWeight: '700',
    fontSize: 13,
  },
  connectBtnHighlight: {
    color: '#93C5FD',
  },
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 8,
  },
  emptyText: {
    color: '#4B5563',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
