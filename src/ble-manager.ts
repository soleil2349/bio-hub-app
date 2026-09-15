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
  parseBioPkt,
  buildCtrlPkt,
  detectConnectionType,
  CMD_HEARTBEAT,
  CMD_TOGGLE,
  CMD_SET_LED,
  CMD_PING,
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

class BioBleMgr {
  private mgr: BleManager;
  private device: Device | null = null;
  private ctrlSeq = 0;
  private startTime = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private serviceUUID: string | null = null;
  private charUUID: string | null = null;

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

  subscribeToNotifications(
    onData: (pkt: BioPkt) => void,
    onError?: (error: Error) => void,
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
        if (!gotFirst) {
          gotFirst = true;
          this.log(`First data! ${raw.length} bytes: ${raw.toString('hex').substring(0, 40)}`);
        }
        const pkt = parseBioPkt(new Uint8Array(raw));
        if (pkt) onData(pkt);
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
