/**
 * BLE/SLE manager singleton for BIO_HUB sensor communication.
 *
 * Handles scanning, connection, GATT discovery, notifications, and control.
 * Supports both standard BLE and SLE (SparkLink/NearLink) connections
 * through the Hi3863 BLE compatibility layer.
 */
import { BleManager, Device, Characteristic, State, Service } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import {
  KNOWN_SERVICE_UUIDS,
  KNOWN_CHAR_UUIDS,
  BLE_SERVICE_UUIDS,
  SLE_SERVICE_UUIDS,
  BLE_DEVICE_NAME,
  SLE_DEVICE_NAME,
  BioPkt,
  ConnectionType,
  WaveformFrame,
  StatsFrame,
  FrameKind,
  classifyFrame,
  parseBioPkt,
  parseWaveformFrame,
  parseStatsFrame,
  buildCtrlPkt,
  detectConnectionType,
  streamSeq,
  CMD_HEARTBEAT,
  CMD_TOGGLE,
  CMD_SET_LED,
  CMD_PING,
  CMD_STREAM,
  CMD_SET_RATE,
  CMD_STATS,
} from './protocol';

/** Standard BLE UUIDs that should be skipped during auto-discovery */
const STANDARD_SKIP = new Set([
  '00001800',
  '00001801',
  '0000180a',
  '0000180f',
]);

function isStandardService(uuid: string): boolean {
  return STANDARD_SKIP.has(uuid.substring(0, 8).toLowerCase());
}

export interface CharInfo {
  uuid: string;
  props: string[];
}

export interface ServiceInfo {
  uuid: string;
  chars: CharInfo[];
}

export interface DiscoveryResult {
  serviceUUID: string;
  charUUID: string;
  method: 'known' | 'auto';
  connectionType: ConnectionType;
}

/** 通知分流的可选回调（协议 v4）：波形帧与统计帧走这里，不认识的帧只计数 */
export interface NotificationHooks {
  onWaveform?: (frame: WaveformFrame) => void;
  onStats?: (stats: StatsFrame) => void;
}

class BioBleMgr {
  private mgr: BleManager;
  private device: Device | null = null;
  private ctrlSeq = 0;
  private startTime = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private serviceUUID: string | null = null;
  private charUUID: string | null = null;

  /** 无法识别的帧数（含旧固件 0xEC 波形帧）——诊断用，绝不静默吞咽 */
  private rxUnknown = 0;
  /** 识别为已知类型但结构畸形的帧数 */
  private rxMalformed = 0;
  /** 最近一次统计帧（链路质量快照） */
  private lastStats: StatsFrame | null = null;

  /** Exposed so the UI can show which UUIDs were found */
  public discoveryInfo: DiscoveryResult | null = null;
  /** All discovered services for debug display */
  public allServices: ServiceInfo[] = [];
  /** Debug log lines visible in the UI */
  public debugLog: string[] = [];

  constructor() {
    this.mgr = new BleManager();
  }

  private log(msg: string): void {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `[${ts}] ${msg}`;
    this.debugLog.push(line);
    if (this.debugLog.length > 80) this.debugLog.shift();
    console.log(msg);
  }

  /** Get the detected connection type for the current session */
  getConnectionType(): ConnectionType {
    return this.discoveryInfo?.connectionType ?? 'unknown';
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    const apiLevel = Platform.Version;
    if (typeof apiLevel === 'number' && apiLevel >= 31) {
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED,
      );
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  async waitForPoweredOn(): Promise<void> {
    const state = await this.mgr.state();
    if (state === State.PoweredOn) return;
    return new Promise((resolve) => {
      const sub = this.mgr.onStateChange((s) => {
        if (s === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  startScan(
    onDevice: (device: Device) => void,
    onError?: (error: Error) => void,
  ): void {
    this.log('Starting BLE/SLE scan...');
    this.mgr.startDeviceScan(null, { allowDuplicates: false }, (err, dev) => {
      if (err) {
        this.log(`Scan error: ${err.message}`);
        onError?.(err);
        return;
      }
      if (dev) onDevice(dev);
    });
  }

  stopScan(): void {
    this.mgr.stopDeviceScan();
  }

  /**
   * Connect to a device, discover services/characteristics, and locate the
   * data characteristic automatically. Works for both BLE and SLE devices.
   */
  async connect(device: Device): Promise<Device> {
    this.debugLog = [];
    this.allServices = [];

    const name = device.localName || device.name || device.id;
    const isSLEName = name.includes(SLE_DEVICE_NAME);
    this.log(`Connecting to ${name}...`);
    if (isSLEName) {
      this.log('(Device name suggests SLE/NearLink connection)');
    }

    this.device = await device.connect({ requestMTU: 512 });
    this.log('Connected, discovering GATT services...');
    await this.device.discoverAllServicesAndCharacteristics();
    this.log('GATT discovery complete');

    const found = await this.findDataCharacteristic();
    if (!found) {
      this.log('!! NO suitable data characteristic found!');
    } else {
      const type = this.discoveryInfo?.connectionType ?? 'unknown';
      this.log(`Connection type: ${type === 'SLE' ? 'SLE (NearLink/SparkLink)' : type === 'BLE' ? 'BLE (Bluetooth)' : 'Unknown (auto-discovered)'}`);
    }

    return this.device;
  }

  /**
   * Walk all services/characteristics looking for our data channel.
   * Strategy:
   *   1. Check BLE-native UUIDs first.
   *   2. Check SLE UUIDs next.
   *   3. Fall back to first non-standard service with a NOTIFY characteristic.
   */
  private async findDataCharacteristic(): Promise<boolean> {
    if (!this.device) return false;

    const services: Service[] = await this.device.services();
    this.log(`Found ${services.length} service(s)`);

    const knownSvcSet = new Set(KNOWN_SERVICE_UUIDS.map((u) => u.toLowerCase()));
    const knownCharSet = new Set(KNOWN_CHAR_UUIDS.map((u) => u.toLowerCase()));

    for (const svc of services) {
      const svcUuid = svc.uuid.toLowerCase();
      const chars = await svc.characteristics();
      const charInfos: CharInfo[] = [];

      for (const ch of chars) {
        const chUuid = ch.uuid.toLowerCase();
        const props: string[] = [];
        if (ch.isNotifiable) props.push('N');
        if (ch.isIndicatable) props.push('I');
        if (ch.isWritableWithoutResponse) props.push('Wnr');
        if (ch.isWritableWithResponse) props.push('W');
        if (ch.isReadable) props.push('R');
        charInfos.push({ uuid: chUuid, props });
      }

      this.allServices.push({ uuid: svcUuid, chars: charInfos });
      this.log(`SVC ${svcUuid.substring(0, 8)}  (${charInfos.length} char)`);
      for (const ci of charInfos) {
        this.log(`  CHR ${ci.uuid.substring(0, 8)}  [${ci.props.join(',')}]`);
      }
    }

    // Pass 1 — match BLE-native UUIDs (priority)
    const bleServiceSet = new Set(BLE_SERVICE_UUIDS.map((u) => u.toLowerCase()));
    for (const svc of this.allServices) {
      if (!bleServiceSet.has(svc.uuid)) continue;
      for (const ch of svc.chars) {
        if (ch.props.includes('N') || ch.props.includes('I')) {
          this.serviceUUID = svc.uuid;
          this.charUUID = ch.uuid;
          this.discoveryInfo = {
            serviceUUID: svc.uuid,
            charUUID: ch.uuid,
            method: 'known',
            connectionType: 'BLE',
          };
          this.log(`[BLE] MATCH  svc=${svc.uuid}`);
          this.log(`  char=${ch.uuid}`);
          return true;
        }
      }
    }

    // Pass 2 — match SLE UUIDs
    const sleServiceSet = new Set(SLE_SERVICE_UUIDS.map((u) => u.toLowerCase()));
    for (const svc of this.allServices) {
      if (!sleServiceSet.has(svc.uuid)) continue;
      for (const ch of svc.chars) {
        if (ch.props.includes('N') || ch.props.includes('I')) {
          this.serviceUUID = svc.uuid;
          this.charUUID = ch.uuid;
          this.discoveryInfo = {
            serviceUUID: svc.uuid,
            charUUID: ch.uuid,
            method: 'known',
            connectionType: 'SLE',
          };
          this.log(`[SLE] MATCH  svc=${svc.uuid}`);
          this.log(`  char=${ch.uuid}`);
          return true;
        }
      }
    }

    // Pass 3 — match any known char UUID
    for (const svc of this.allServices) {
      for (const ch of svc.chars) {
        if (knownSvcSet.has(svc.uuid) || knownCharSet.has(ch.uuid)) {
          if (ch.props.includes('N') || ch.props.includes('I')) {
            this.serviceUUID = svc.uuid;
            this.charUUID = ch.uuid;
            const connType = detectConnectionType(svc.uuid, ch.uuid);
            this.discoveryInfo = {
              serviceUUID: svc.uuid,
              charUUID: ch.uuid,
              method: 'known',
              connectionType: connType,
            };
            this.log(`[${connType}] MATCH  svc=${svc.uuid}`);
            this.log(`  char=${ch.uuid}`);
            return true;
          } else {
            this.log(`!! Known UUID found but NO notify prop: [${ch.props}]`);
          }
        }
      }
    }

    // Pass 4 — auto-discover any non-standard NOTIFY characteristic
    for (const svc of this.allServices) {
      if (isStandardService(svc.uuid)) continue;
      for (const ch of svc.chars) {
        if (ch.props.includes('N') || ch.props.includes('I')) {
          this.serviceUUID = svc.uuid;
          this.charUUID = ch.uuid;
          this.discoveryInfo = {
            serviceUUID: svc.uuid,
            charUUID: ch.uuid,
            method: 'auto',
            connectionType: 'unknown',
          };
          this.log(`[AUTO] DISCOVER  svc=${svc.uuid}`);
          this.log(`  char=${ch.uuid}`);
          return true;
        }
      }
    }

    this.log('!! No NOTIFY/INDICATE characteristic found anywhere');
    return false;
  }

  /**
   * 订阅通知并在本地按协议 v4 分流。
   *
   * v3 的缺陷：原实现只有 `parseBioPkt(new Uint8Array(raw))`，而 parseBioPkt
   * 只判断 `length < 20` —— 固件在同一特征值上发的波形帧会被当成生理数据
   * 解析（hr = 0xEC = 236）并可能入库。现在先 classifyFrame() 再分派。
   */
  subscribeToNotifications(
    onData: (pkt: BioPkt) => void,
    onError?: (error: Error) => void,
    hooks: NotificationHooks = {},
  ): (() => void) | null {
    if (!this.device || !this.serviceUUID || !this.charUUID) {
      const msg = `Subscribe fail: device=${!!this.device} svc=${this.serviceUUID} char=${this.charUUID}`;
      this.log(msg);
      onError?.(new Error('未发现数据特征值，无法订阅通知'));
      return null;
    }

    this.log(`Subscribing to ${this.charUUID.substring(0, 8)}...`);
    let gotFirst = false;

    const sub = this.device.monitorCharacteristicForService(
      this.serviceUUID,
      this.charUUID,
      (error: any, characteristic: Characteristic | null) => {
        if (error) {
          this.log(`Notify error: ${error.message || error}`);
          onError?.(error);
          return;
        }
        if (!characteristic?.value) return;

        const raw = Buffer.from(characteristic.value, 'base64');
        const bytes = new Uint8Array(raw);
        if (!gotFirst) {
          gotFirst = true;
          this.log(`First data! ${raw.length} bytes: ${raw.toString('hex').substring(0, 40)}`);
        }

        // ★ 严格分流（协议 v4 §4）：不认识的帧一律丢弃并计数，
        //   绝不"长度够就当成生理数据" —— v3 的 parser 正是这样被波形帧污染的。
        const kind: FrameKind = classifyFrame(bytes);
        switch (kind) {
          case 'bio_pkt': {
            const pkt = parseBioPkt(bytes);
            if (pkt) onData(pkt);
            else this.rxMalformed++;
            break;
          }
          case 'waveform': {
            const frame = parseWaveformFrame(bytes);
            if (frame) hooks.onWaveform?.(frame);
            else this.rxMalformed++;
            break;
          }
          case 'stats': {
            const st = parseStatsFrame(bytes);
            if (st) {
              this.lastStats = st;
              hooks.onStats?.(st);
            } else {
              this.rxMalformed++;
            }
            break;
          }
          default:
            // 含旧固件 0xEC 波形帧、未知帧：丢弃计数
            this.rxUnknown++;
            break;
        }
      },
    );

    this.log('Subscribe OK, waiting for data...');
    return () => sub.remove();
  }

  private async writeCmd(cmd: number, seqOverride?: number): Promise<void> {
    if (!this.device || !this.serviceUUID || !this.charUUID) {
      throw new Error('未连接或未发现特征值');
    }
    const uptimeS = Math.floor((Date.now() - this.startTime) / 1000);
    // seqOverride 用于 CMD_SET_LED：LED 模式值借 seq 字段传给固件
    const seq = seqOverride !== undefined ? (seqOverride & 0xff) : this.ctrlSeq++;
    const pkt = buildCtrlPkt(cmd, seq, uptimeS);
    const b64 = Buffer.from(pkt).toString('base64');

    await this.device.writeCharacteristicWithoutResponseForService(
      this.serviceUUID,
      this.charUUID,
      b64,
    );
  }

  async sendHeartbeat(): Promise<void> {
    await this.writeCmd(CMD_HEARTBEAT);
  }

  async sendToggle(): Promise<void> {
    await this.writeCmd(CMD_TOGGLE);
  }

  /** V3 固件：设置板载 LED 模式（LED_MODE_AUTO / ON / OFF / BLINK）*/
  async sendSetLed(mode: number): Promise<void> {
    await this.writeCmd(CMD_SET_LED, mode);
  }

  /** V3 固件：回声测试，设备收到后在串口打印 [SRV] PING ... */
  async sendPing(): Promise<void> {
    await this.writeCmd(CMD_PING);
  }

  /** V4：开启/关闭波形流（需先连接）。默认关闭以省带宽 */
  async setStream(ecg: boolean, ppg: boolean): Promise<void> {
    await this.writeCmd(CMD_STREAM, streamSeq(ecg, ppg));
  }

  /** V4：设置采样率组合（BIO_RATE_*，见 protocol.ts） */
  async setRate(code: number): Promise<void> {
    await this.writeCmd(CMD_SET_RATE, code);
  }

  /** V4：统计帧控制（0=立即一次 1=1Hz常开 2=关闭） */
  async setStats(mode: number): Promise<void> {
    await this.writeCmd(CMD_STATS, mode);
  }

  /** 收到但无法识别/畸形的帧计数（用于诊断与上传质量元数据） */
  get frameRxStats(): { unknown: number; malformed: number; lastStats: StatsFrame | null } {
    return { unknown: this.rxUnknown, malformed: this.rxMalformed, lastStats: this.lastStats };
  }

  /** 清空帧计数（开始新会话时调用） */
  resetFrameRxStats(): void {
    this.rxUnknown = 0;
    this.rxMalformed = 0;
    this.lastStats = null;
  }

  startHeartbeatLoop(): void {
    this.stopHeartbeatLoop();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, 2000);
  }

  stopHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeatLoop();
    this.serviceUUID = null;
    this.charUUID = null;
    this.discoveryInfo = null;
    if (this.device) {
      try {
        await this.device.cancelConnection();
      } catch (_) {}
      this.device = null;
    }
  }

  onDisconnect(callback: () => void): (() => void) | null {
    if (!this.device) return null;
    const sub = this.mgr.onDeviceDisconnected(this.device.id, () => {
      this.stopHeartbeatLoop();
      this.device = null;
      this.serviceUUID = null;
      this.charUUID = null;
      this.discoveryInfo = null;
      callback();
    });
    return () => sub.remove();
  }

  isConnected(): boolean {
    return this.device !== null;
  }

  destroy(): void {
    this.stopHeartbeatLoop();
    this.mgr.destroy();
  }
}

export const bioBleMgr = new BioBleMgr();
