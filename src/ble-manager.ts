import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import {
  SERVICE_UUID,
  CHARACTERISTIC_UUID,
  BLE_DEVICE_NAME,
  BioPkt,
  parseBioPkt,
  buildCtrlPkt,
  CMD_HEARTBEAT,
  CMD_TOGGLE,
} from './protocol';

class BioBleMgr {
  private mgr: BleManager;
  private device: Device | null = null;
  private ctrlSeq = 0;
  private startTime = Date.now();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

  async connect(device: Device): Promise<Device> {
    this.device = await device.connect({ requestMTU: 512 });
    await this.device.discoverAllServicesAndCharacteristics();
    return this.device;
  }

  subscribeToNotifications(
    onData: (pkt: BioPkt) => void,
    onError?: (error: Error) => void,
  ): (() => void) | null {
    if (!this.device) return null;

    const sub = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
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
    if (!this.device) return;
    const uptimeS = Math.floor((Date.now() - this.startTime) / 1000);
    const pkt = buildCtrlPkt(cmd, this.ctrlSeq++, uptimeS);
    const b64 = Buffer.from(pkt).toString('base64');

    await this.device.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
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
