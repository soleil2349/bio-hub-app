/**
 * BLE protocol definitions for BIO_HUB (sensor_hub) board.
 * Matches bio_pkt.h V2 on the firmware side.
 */

export const BLE_DEVICE_NAME = 'BIO_HUB';

/**
 * The firmware registers GATT via SLE (Spark Link) which shares the
 * database with BLE on Hi3863. The exact 128-bit UUID exposed to a
 * standard BLE client depends on the SLE→BLE mapping inside the chip.
 *
 * We try several known patterns and fall back to auto-discovery.
 */
export const KNOWN_SERVICE_UUIDS = [
  '0000abcd-0000-1000-8000-00805f9b34fb',          // standard BLE base
  '37bea880-fc70-11ea-b720-00000000cdab',          // SLE base, LE short
  '37bea880-fc70-11ea-b720-00000000abcd',          // SLE base, BE short
];

export const KNOWN_CHAR_UUIDS = [
  '0000bcde-0000-1000-8000-00805f9b34fb',
  '37bea880-fc70-11ea-b720-00000000debc',
  '37bea880-fc70-11ea-b720-00000000bcde',
];

export const CMD_HEARTBEAT = 0;
export const CMD_TOGGLE = 1;

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
 * Parse 20-byte bio_pkt_t from BLE notification.
 * Layout (little-endian, packed):
 *   [0]    uint8   hr
 *   [1]    uint8   spo2
 *   [2-5]  uint32  ir
 *   [6]    int8    temp_i
 *   [7]    uint8   temp_f (low 4 bits × 0.0625)
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
