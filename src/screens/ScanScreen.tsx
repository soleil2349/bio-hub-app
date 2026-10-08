/**
 * Device scan screen — BLE + SLE (NearLink) discovery.
 *
 * Layout notes
 * ------------
 *  - The header no longer hard-codes `paddingTop: 48`; it sits inside `Screen`,
 *    which applies the real top inset. On a notched iOS device the old value
 *    stacked on top of `SafeAreaView`'s own inset and pushed everything down.
 *  - Device rows are overflow-safe: the name shrinks and clamps to one line
 *    while the BLE/SLE pill stays put, so a long advertised name can no longer
 *    push the "连接" affordance off the right edge.
 *  - Signal strength is drawn as bars instead of the `▁▃▅▇` text glyphs, which
 *    were rendered by the system font at a weight and baseline we did not
 *    control and did not align with anything else on screen.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Animated, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr } from '../ble-manager';
import { SLE_DEVICE_NAME, BLE_DEVICE_NAME, matchDeviceName, type ConnectionType } from '../protocol';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  EmptyState,
  Pill,
  Screen,
  ScreenHeader,
  SegmentedControl,
  SkeletonRow,
} from '../components/ui';
import { color, monoFont, radius, space, tabularNums, type } from '../theme';

interface Props {
  onConnected: (device: Device) => void;
  scanDuration?: number;
}

type FilterMode = 'all' | 'bio' | 'ble' | 'sle';

const FILTERS = [
  { value: 'all' as const, label: '全部' },
  { value: 'bio' as const, label: 'BIO HUB' },
  { value: 'ble' as const, label: 'BLE' },
  { value: 'sle' as const, label: 'SLE' },
];

function getDeviceType(name: string | null): ConnectionType {
  if (!name) return 'unknown';
  if (name.includes(SLE_DEVICE_NAME)) return 'SLE';
  if (name.includes(BLE_DEVICE_NAME)) return 'BLE';
  return 'unknown';
}

/** Four drawn bars. Level is derived from RSSI, never from a glyph string. */
function SignalBars({ rssi }: { rssi: number | null }) {
  const level = rssi === null ? 0 : rssi > -50 ? 4 : rssi > -65 ? 3 : rssi > -80 ? 2 : 1;
  const tint =
    level >= 3 ? color.success : level === 2 ? color.warning : level === 1 ? color.danger : color.neutral;

  return (
    <View style={styles.bars} accessibilityLabel={rssi === null ? '信号未知' : `信号强度 ${level} 级`}>
      {[1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { height: 3 + i * 3, backgroundColor: i <= level ? tint : color.border },
          ]}
        />
      ))}
    </View>
  );
}

export default function ScanScreen({ onConnected, scanDuration = 10 }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  /** Inline permission state, shown in place instead of a blocking alert. */
  const [permissionDenied, setPermissionDenied] = useState(false);
  /** Inline connect failure, shown in place instead of a blocking alert. */
  const [connectError, setConnectError] = useState<string | null>(null);
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
    }
    pulseAnim.setValue(1);
  }, [scanning, pulseAnim]);

  const startScan = useCallback(async () => {
    const ok = await bioBleMgr.requestPermissions();
    if (!ok) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

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
          const aScore = matchDeviceName(aName).isMatch ? 0 : 1;
          const bScore = matchDeviceName(bName).isMatch ? 0 : 1;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      console.warn('Connect failed:', err);
      setConnectError(err?.message || '无法连接到设备，请靠近后重试');
      setConnecting(null);
    }
  };

  const renderDevice = ({ item }: { item: Device }) => {
    const name = item.localName || item.name || '未知设备';
    const match = matchDeviceName(name);
    const isConnecting = connecting === item.id;
    const devType = getDeviceType(name);

    return (
      <View style={[styles.deviceCard, match.isMatch && styles.deviceCardMatch]}>
        <View style={styles.deviceInfo}>
          <View style={styles.deviceTitleRow}>
            {/* flexShrink keeps a long advertised name from pushing the pill out. */}
            <Text
              style={[type.h2, styles.deviceName, match.isMatch && styles.deviceNameMatch]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {name}
            </Text>
            {match.isMatch ? (
              <Pill label={devType === 'SLE' ? 'SLE' : 'BLE'} tone={devType === 'SLE' ? 'violet' : 'accent'} />
            ) : null}
          </View>

          <Text style={[styles.deviceId, tabularNums]} numberOfLines={1} ellipsizeMode="middle">
            {item.id}
          </Text>

          <View style={styles.deviceMetaRow}>
            <SignalBars rssi={item.rssi} />
            <Text style={[type.caption, styles.deviceRssi]} numberOfLines={1}>
              {item.rssi ?? '?'} dBm
            </Text>
          </View>
        </View>

        <View style={styles.deviceAction}>
          <Button
            label={isConnecting ? '连接中' : '连接'}
            size="sm"
            variant={match.isMatch ? 'primary' : 'secondary'}
            loading={isConnecting}
            disabled={isConnecting || connecting !== null}
            onPress={() => handleConnect(item)}
          />
        </View>
      </View>
    );
  };

  const bioCount = devices.filter((d) => matchDeviceName(d.localName || d.name || '').isMatch).length;

  return (
    <Screen>
      <ScreenHeader
        title="设备扫描"
        subtitle={`BLE + 星闪 NearLink · 找到 ${devices.length} 个设备`}
        actions={
          <View style={styles.liveTag}>
            <Animated.View style={{ opacity: scanning ? pulseAnim : 1 }}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: scanning ? color.success : color.neutral },
                ]}
              />
            </Animated.View>
            <Text style={[type.caption, styles.liveText]}>{scanning ? '扫描中' : '已停止'}</Text>
          </View>
        }
      />

      <View style={styles.filterBar}>
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />
      </View>

      <View style={styles.scanBar}>
        <Text style={[type.label, styles.scanStatus]} numberOfLines={2}>
          {scanning
            ? '正在扫描附近设备…'
            : `共 ${devices.length} 个设备 · 其中 ${bioCount} 个 BIO HUB`}
        </Text>
        <Button
          label={scanning ? '扫描中' : '重新扫描'}
          icon={scanning ? undefined : 'refresh'}
          size="sm"
          variant="primary"
          loading={scanning}
          disabled={scanning || connecting !== null}
          onPress={startScan}
        />
      </View>

      {permissionDenied ? (
        <View style={styles.noticeWrap}>
          <Card style={styles.notice}>
            <View style={styles.noticeHeader}>
              <Icon name="alert" size={17} color={color.warningText} />
              <Text style={[type.h2, styles.noticeTitle]}>需要蓝牙与位置权限</Text>
            </View>
            <Text style={[type.body, styles.noticeText]}>
              缺少权限时无法搜索附近的传感器。请到系统设置中为本应用开启蓝牙和位置权限，然后重新扫描。
            </Text>
            <Button label="重新扫描" icon="refresh" variant="primary" size="sm" onPress={startScan} />
          </Card>
        </View>
      ) : null}

      {connectError ? (
        <View style={styles.noticeWrap}>
          <Card style={styles.noticeError}>
            <View style={styles.noticeHeader}>
              <Icon name="alert" size={17} color={color.dangerText} />
              <Text style={[type.h2, styles.noticeTitleError]}>连接失败</Text>
              <View style={styles.spacer} />
              <Pressable onPress={() => setConnectError(null)} hitSlop={10}>
                <Text style={[type.label, styles.noticeDismiss]}>知道了</Text>
              </Pressable>
            </View>
            <Text style={[type.body, styles.noticeTextError]}>{connectError}</Text>
          </Card>
        </View>
      ) : null}

      {scanning && filteredDevices.length === 0 ? (
        <View style={styles.skeletonWrap}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </View>
      ) : (
        <FlatList
          data={filteredDevices}
          keyExtractor={(d) => d.id}
          renderItem={renderDevice}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
          ListEmptyComponent={
            <EmptyState
              icon={scanning ? 'search' : 'bluetooth'}
              title={scanning ? '正在搜索设备' : '未发现设备'}
              description={
                scanning
                  ? '正在搜索附近的 BLE 和星闪设备，请稍候…'
                  : '请确认传感器已开机并处于广播状态，然后点击「重新扫描」。设备的广播名通常以 BIO_HUB 开头。'
              }
              action={
                scanning ? undefined : (
                  <Button label="重新扫描" icon="refresh" variant="primary" onPress={startScan} />
                )
              }
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { color: color.textMuted },

  filterBar: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: color.surface,
  },
  scanBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  scanStatus: { color: color.textMuted, flex: 1, minWidth: 0, fontWeight: '400' },

  list: { padding: space.md, paddingBottom: space.xxxl, flexGrow: 1 },
  skeletonWrap: { padding: space.md },

  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.md,
  },
  deviceCardMatch: { borderColor: color.accentBorder, backgroundColor: color.accentSurface },
  deviceInfo: { flex: 1, minWidth: 0, gap: space.xs },
  deviceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  deviceName: { color: color.text, flexShrink: 1, minWidth: 0 },
  deviceNameMatch: { color: color.accentText },
  deviceId: {
    fontSize: 11,
    lineHeight: 15,
    color: color.textFaint,
    fontFamily: monoFont,
  },
  deviceMetaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xxs },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 15 },
  bar: { width: 3, borderRadius: 1.5 },
  deviceRssi: { color: color.textMuted },
  deviceAction: { flexShrink: 0 },

  noticeWrap: { paddingHorizontal: space.md, paddingTop: space.md },
  notice: { borderColor: color.warningBorder },
  noticeError: { borderColor: color.dangerBorder },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.sm,
  },
  noticeTitle: { color: color.warningText, flexShrink: 1 },
  noticeTitleError: { color: color.dangerText, flexShrink: 1 },
  noticeText: { color: color.textSecondary, marginBottom: space.md },
  noticeTextError: { color: color.textSecondary },
  noticeDismiss: { color: color.accentText, fontWeight: '600' },
  spacer: { flex: 1 },
});
