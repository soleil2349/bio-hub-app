/**
 * BLE/SLE protocol definitions for BIO_HUB (sensor_hub) board.
 * Matches bio_pkt.h V2 on the firmware side.
 *
 * Supports both standard BLE and SLE (SparkLink/NearLink) connections.
 * On Hi3863, SLE GATT shares the database with BLE, so the mobile app
 * uses BLE APIs but may encounter SLE-specific UUIDs.
 */

/* ─── Device Name Patterns ─── */

export const BLE_DEVICE_NAME = 'BIO_HUB';
export const SLE_DEVICE_NAME = 'BIO_HUB_SLE';

/** All known device name patterns (used for scan filtering & highlight) */
export const KNOWN_DEVICE_NAMES = [BLE_DEVICE_NAME, SLE_DEVICE_NAME];

/* ─── Connection Type ─── */

export type ConnectionType = 'BLE' | 'SLE' | 'unknown';

/* ─── BLE GATT UUIDs (standard Bluetooth) ─── */

export const BLE_SERVICE_UUIDS = [
  '0000fbb0-0000-1000-8000-00805f9b34fb',
];

export const BLE_CHAR_UUIDS = [
  '0000fbb1-0000-1000-8000-00805f9b34fb',
];

/* ─── SLE GATT UUIDs (SparkLink / NearLink / 星闪) ─── */

export const SLE_SERVICE_UUIDS = [
  '0000abcd-0000-1000-8000-00805f9b34fb',
];

export const SLE_CHAR_UUIDS = [
  '0000cdef-0000-1000-8000-00805f9b34fb',
];

/* ─── Combined UUID Lists ─── */

export const KNOWN_SERVICE_UUIDS = [...BLE_SERVICE_UUIDS, ...SLE_SERVICE_UUIDS];
export const KNOWN_CHAR_UUIDS = [...BLE_CHAR_UUIDS, ...SLE_CHAR_UUIDS];

/* ─── Control Commands ─── */

export const CMD_HEARTBEAT = 0;
export const CMD_TOGGLE = 1;

/* ─── Sensor Data Packet ─── */

export interface BioPkt {
  hr: number;
  spo2: number;
  ir: number;
  tempC: number;
  pi: number;
  sbp: number;
  dbp: number;
  flags: {
    maxOk: boolean;
    bmdOk: boolean;
    finger: boolean;
    pttValid: boolean;
  };
  pttMs: number;
  ecgHr: number;
  ecgSig: number;
  ecgRaw: number;
  rrMs: number;
}

/**
 * Parse 20-byte bio_pkt_t from BLE/SLE notification.
 * Layout (little-endian, packed):
 *   [0]    uint8   hr
 *   [1]    uint8   spo2
 *   [2-5]  uint32  ir
 *   [6]    int8    temp_i
 *   [7]    uint8   temp_f (low 4 bits * 0.0625)
 *   [8]    uint8   pi_x10
 *   [9]    uint8   sbp
 *   [10]   uint8   dbp
 *   [11]   uint8   flags
 *   [12-13] uint16 ptt_ms
 *   [14]   uint8   ecg_hr
 *   [15]   uint8   ecg_sig
 *   [16-17] int16  ecg_raw
 *   [18-19] uint16 rr_ms
 */
export function parseBioPkt(data: Uint8Array): BioPkt | null {
  if (data.length < 20) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const hr = data[0];
  const spo2 = data[1];
  const ir = view.getUint32(2, true);
  const tempI = view.getInt8(6);
  const tempF = (data[7] & 0x0f) * 0.0625;
  const tempC = tempI + tempF;
  const piX10 = data[8];
  const sbp = data[9];
  const dbp = data[10];
  const flagsByte = data[11];
  const pttMs = view.getUint16(12, true);
  const ecgHr = data[14];
  const ecgSig = data[15];
  const ecgRaw = view.getInt16(16, true);
  const rrMs = view.getUint16(18, true);

  return {
    hr,
    spo2,
    ir,
    tempC: Math.round(tempC * 100) / 100,
    pi: piX10 / 10,
    sbp,
    dbp,
    flags: {
      maxOk: !!(flagsByte & 0x01),
      bmdOk: !!(flagsByte & 0x02),
      finger: !!(flagsByte & 0x04),
      pttValid: !!(flagsByte & 0x08),
    },
    pttMs,
    ecgHr,
    ecgSig,
    ecgRaw,
    rrMs,
  };
}

/**
 * Build 4-byte ctrl_pkt_t for writing to the board.
 *   [0] uint8  cmd (0=heartbeat, 1=toggle)
 *   [1] uint8  seq
 *   [2-3] uint16 uptime_s (LE)
 */
export function buildCtrlPkt(
  cmd: number,
  seq: number,
  uptimeS: number,
): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  buf[0] = cmd & 0xff;
  buf[1] = seq & 0xff;
  view.setUint16(2, uptimeS & 0xffff, true);
  return buf;
}

/**
 * Detect connection type from matched UUID.
 * Checks if the UUID belongs to BLE-native or SLE (NearLink) UUID sets.
 */
export function detectConnectionType(serviceUUID: string, charUUID: string): ConnectionType {
  const svc = serviceUUID.toLowerCase();
  const ch = charUUID.toLowerCase();

  const bleServiceSet = new Set(BLE_SERVICE_UUIDS.map((u) => u.toLowerCase()));
  const bleCharSet = new Set(BLE_CHAR_UUIDS.map((u) => u.toLowerCase()));
  const sleServiceSet = new Set(SLE_SERVICE_UUIDS.map((u) => u.toLowerCase()));
  const sleCharSet = new Set(SLE_CHAR_UUIDS.map((u) => u.toLowerCase()));

  if (bleServiceSet.has(svc) || bleCharSet.has(ch)) return 'BLE';
  if (sleServiceSet.has(svc) || sleCharSet.has(ch)) return 'SLE';
  return 'unknown';
}

/**
 * Check if a device name matches known BIO_HUB patterns.
 * Returns the expected connection type based on name.
 */
export function matchDeviceName(name: string | null): {
  isMatch: boolean;
  expectedType: ConnectionType;
} {
  if (!name) return { isMatch: false, expectedType: 'unknown' };
  if (name.includes(SLE_DEVICE_NAME)) return { isMatch: true, expectedType: 'SLE' };
  if (name.includes(BLE_DEVICE_NAME)) return { isMatch: true, expectedType: 'BLE' };
  return { isMatch: false, expectedType: 'unknown' };
}
