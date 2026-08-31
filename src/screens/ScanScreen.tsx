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
} from 'react-native';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr } from '../ble-manager';
import { BLE_DEVICE_NAME } from '../protocol';

interface Props {
  onConnected: (device: Device) => void;
}

export default function ScanScreen({ onConnected }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const devicesRef = useRef<Map<string, Device>>(new Map());

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
          const aMatch = aName.includes(BLE_DEVICE_NAME) ? 0 : 1;
          const bMatch = bName.includes(BLE_DEVICE_NAME) ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
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
    }, 10000);
  }, []);

  useEffect(() => {
    startScan();
    return () => bioBleMgr.stopScan();
  }, [startScan]);

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
    const isBioHub = name.includes(BLE_DEVICE_NAME);
    const isConnecting = connecting === item.id;

    return (
      <TouchableOpacity
        style={[styles.deviceCard, isBioHub && styles.deviceCardHighlight]}
        onPress={() => handleConnect(item)}
        disabled={isConnecting}
      >
        <View style={styles.deviceInfo}>
          <Text style={[styles.deviceName, isBioHub && styles.deviceNameHighlight]}>
            {name}
          </Text>
          <Text style={styles.deviceId}>{item.id}</Text>
          <Text style={styles.deviceRssi}>
            RSSI: {item.rssi ?? '?'} dBm
          </Text>
        </View>
        {isConnecting ? (
          <ActivityIndicator color="#4A90D9" />
        ) : (
          <Text style={[styles.connectBtn, isBioHub && styles.connectBtnHighlight]}>
            连接
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>BIO HUB</Text>
        <Text style={styles.subtitle}>生物传感器蓝牙助手</Text>
      </View>

      <View style={styles.scanBar}>
        <Text style={styles.scanStatus}>
          {scanning
            ? '正在扫描附近设备...'
            : `找到 ${devices.length} 个设备`}
        </Text>
        <TouchableOpacity
          style={styles.scanBtn}
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
        data={devices}
        keyExtractor={(d) => d.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {scanning ? '正在搜索蓝牙设备...' : '未发现设备，点击重新扫描'}
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
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#E0E7FF',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  scanBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
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
  scanBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  list: {
    padding: 12,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
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
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E5E7EB',
  },
  deviceNameHighlight: {
    color: '#93C5FD',
  },
  deviceId: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  deviceRssi: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
  },
  connectBtn: {
    color: '#4A90D9',
    fontWeight: '700',
    fontSize: 14,
    paddingHorizontal: 12,
  },
  connectBtnHighlight: {
    color: '#60A5FA',
  },
  emptyContainer: {
    paddingTop: 80,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 15,
  },
});
