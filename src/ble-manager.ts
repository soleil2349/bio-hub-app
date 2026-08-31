import { BleManager, Device, Characteristic, State, Service } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import {
  KNOWN_SERVICE_UUIDS,
  KNOWN_CHAR_UUIDS,
  BLE_DEVICE_NAME,
  BioPkt,
  parseBioPkt,
  buildCtrlPkt,
  CMD_HEARTBEAT,
  CMD_TOGGLE,
} from './protocol';

/** Standard BLE UUIDs that should be skipped during auto-discovery */
const STANDARD_SKIP = new Set([
  '00001800', // Generic Access
  '00001801', // Generic Attribute
  '0000180a', // Device Information
  '0000180f', // Battery Service
]);

function isStandardService(uuid: string): boolean {
  return STANDARD_SKIP.has(uuid.substring(0, 8).toLowerCase());
}

export interface DiscoveryResult {
  serviceUUID: string;
  charUUID: string;
  method: 'known' | 'auto';
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

  constructor() {
    this.mgr = new BleManager();
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
    this.mgr.startDeviceScan(null, { allowDuplicates: false }, (err, dev) => {
      if (err) {
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
   * data characteristic automatically.
   */
  async connect(device: Device): Promise<Device> {
    this.device = await device.connect({ requestMTU: 512 });
    await this.device.discoverAllServicesAndCharacteristics();

    const found = await this.findDataCharacteristic();
    if (!found) {
      console.warn('[BLE] Could not find a suitable data characteristic');
    }

    return this.device;
  }

  /**
   * Walk all services/characteristics looking for our data channel.
   * Strategy:
   *   1. Check known UUID lists first.
   *   2. Fall back to the first non-standard service with a NOTIFY characteristic.
   */
  private async findDataCharacteristic(): Promise<boolean> {
    if (!this.device) return false;

    const services: Service[] = await this.device.services();
    console.log(`[BLE] Found ${services.length} services`);

    // Pass 1 — match against known UUIDs
    const knownSvcSet = new Set(KNOWN_SERVICE_UUIDS.map(u => u.toLowerCase()));
    const knownCharSet = new Set(KNOWN_CHAR_UUIDS.map(u => u.toLowerCase()));

    for (const svc of services) {
      const svcUuid = svc.uuid.toLowerCase();
      console.log(`[BLE]   service: ${svcUuid}`);
      const chars = await svc.characteristics();

      for (const ch of chars) {
        const chUuid = ch.uuid.toLowerCase();
        const props = [];
        if (ch.isNotifiable) props.push('NOTIFY');
        if (ch.isIndicatable) props.push('INDICATE');
        if (ch.isWritableWithoutResponse) props.push('WRITE_NR');
        if (ch.isWritableWithResponse) props.push('WRITE');
        if (ch.isReadable) props.push('READ');
        console.log(`[BLE]     char: ${chUuid}  [${props.join(',')}]`);

        if (knownSvcSet.has(svcUuid) || knownCharSet.has(chUuid)) {
          if (ch.isNotifiable || ch.isIndicatable) {
            this.serviceUUID = svc.uuid;
            this.charUUID = ch.uuid;
            this.discoveryInfo = { serviceUUID: svc.uuid, charUUID: ch.uuid, method: 'known' };
            console.log(`[BLE] ✓ Matched known UUID  svc=${svc.uuid}  char=${ch.uuid}`);
            return true;
          }
        }
      }
    }

    // Pass 2 — auto-discover: first non-standard service with NOTIFY char
    for (const svc of services) {
      if (isStandardService(svc.uuid)) continue;

      const chars = await svc.characteristics();
      for (const ch of chars) {
        if (ch.isNotifiable || ch.isIndicatable) {
          this.serviceUUID = svc.uuid;
          this.charUUID = ch.uuid;
          this.discoveryInfo = { serviceUUID: svc.uuid, charUUID: ch.uuid, method: 'auto' };
          console.log(`[BLE] ✓ Auto-discovered  svc=${svc.uuid}  char=${ch.uuid}`);
          return true;
        }
      }
    }

    return false;
  }

  subscribeToNotifications(
    onData: (pkt: BioPkt) => void,
    onError?: (error: Error) => void,
  ): (() => void) | null {
    if (!this.device || !this.serviceUUID || !this.charUUID) {
      onError?.(new Error('未发现数据特征值，无法订阅通知'));
      return null;
    }

    const sub = this.device.monitorCharacteristicForService(
      this.serviceUUID,
      this.charUUID,
      (error: any, characteristic: Characteristic | null) => {
        if (error) {
          onError?.(error);
          return;
        }
        if (!characteristic?.value) return;

        const raw = Buffer.from(characteristic.value, 'base64');
        const pkt = parseBioPkt(new Uint8Array(raw));
        if (pkt) onData(pkt);
      },
    );

    return () => sub.remove();
  }

  private async writeCmd(cmd: number): Promise<void> {
    if (!this.device || !this.serviceUUID || !this.charUUID) {
      throw new Error('未连接或未发现特征值');
    }
    const uptimeS = Math.floor((Date.now() - this.startTime) / 1000);
    const pkt = buildCtrlPkt(cmd, this.ctrlSeq++, uptimeS);
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
