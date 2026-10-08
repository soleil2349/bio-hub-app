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
/** V3 新增：设置板载 LED 模式，模式值放在 seq 字段 */
export const CMD_SET_LED = 2;
/** V3 新增：回声测试（设备收到后打日志，用于确认链路连通） */
export const CMD_PING = 3;
/** V4 新增：波形流开关，seq = bit0 ECG | bit1 PPG（0 = 全关） */
export const CMD_STREAM = 4;
/** V4 新增：采样率组合，seq = BIO_RATE_* */
export const CMD_SET_RATE = 5;
/** V4 新增：统计帧控制，seq: 0=立即一次 1=1Hz 常开 2=关闭 */
export const CMD_STATS = 6;
/** V4 新增：清零板载统计计数器 */
export const CMD_RESET_STATS = 7;

/* ─── V4：波形流帧（与固件 PROTOCOL_V4.md / bio_pkt.h 完全一致）─── */

/** 波形帧魔数。bio_pkt 首字节是心率且被固件夹在 <=220，故 0xE1(225) 永不冲突 */
export const WF_MAGIC = 0xe1;
/** 统计帧魔数 */
export const ST_MAGIC = 0xe2;
export const WF_HDR_LEN = 7;
export const ST_LEN = 32;

export const WF_SIG_ECG = 1;
export const WF_SIG_PPG = 2;
export const WF_FMT_I16 = 1;
export const WF_FMT_U32X2 = 5;

/** 心率合理上限：固件按此夹紧，解析器也用它做帧判别 */
export const HR_SANITY_MAX = 220;

export const PKT_LEN_V2 = 20;
export const PKT_LEN_V3 = 21;
export const PKT_LEN_V4 = 24;

/** 采样率组合（CMD_SET_RATE 的 seq） */
export const BIO_RATE_512_100 = 0;
export const BIO_RATE_256_100 = 1;
export const BIO_RATE_512_200 = 2;
export const BIO_RATE_128_50 = 3;

export const BIO_RATE_LABELS: Record<number, string> = {
  [BIO_RATE_512_100]: 'ECG 512Hz + PPG 100Hz',
  [BIO_RATE_256_100]: 'ECG 256Hz + PPG 100Hz',
  [BIO_RATE_512_200]: 'ECG 512Hz + PPG 200Hz',
  [BIO_RATE_128_50]: 'ECG 128Hz + PPG 50Hz',
};

/** stream_state 位（bio_pkt.streamState / stats.streamState） */
export const BIO_SS_ECG_ON = 0x01;
export const BIO_SS_PPG_ON = 0x02;
export const BIO_SS_TIME_VALID = 0x04;
export const BIO_SS_DROP_1S = 0x08;
export const BIO_SS_PPG_FINGER = 0x10;

/* ─── LED Modes (CMD_SET_LED 的 seq 值) ─── */

export const LED_MODE_AUTO = 0;   // 固件按连接状态自动显示
export const LED_MODE_ON = 1;     // 常亮
export const LED_MODE_OFF = 2;    // 常灭
export const LED_MODE_BLINK = 3;  // 快闪（在设备堆里识别本机）

export const LED_MODE_LABELS: Record<number, string> = {
  [LED_MODE_AUTO]: '自动',
  [LED_MODE_ON]: '常亮',
  [LED_MODE_OFF]: '常灭',
  [LED_MODE_BLINK]: '快闪',
};

/* ─── Device Status Byte（V3 固件 bio_pkt_t 第 21 字节）─── */

export const BIO_ST_SLE_CONN = 0x01;   // 星闪 SLE 客户端已连接
export const BIO_ST_BLE_CONN = 0x02;   // BLE 客户端已连接
export const BIO_ST_PAUSED = 0x04;     // 数据推送已暂停
export const BIO_ST_MAX_OK = 0x08;     // MAX30102 正常
export const BIO_ST_BMD_OK = 0x10;     // BMD101 正常
export const BIO_ST_FINGER = 0x20;     // 检测到手指
export const BIO_ST_LED_ON = 0x40;     // 板载 LED 当前点亮
export const BIO_ST_LED_MANUAL = 0x80; // LED 处于 App 手动模式

export interface DeviceStatus {
  sleConn: boolean;
  bleConn: boolean;
  paused: boolean;
  maxOk: boolean;
  bmdOk: boolean;
  finger: boolean;
  ledOn: boolean;
  ledManual: boolean;
}

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
  /** V3 固件（21 字节包）新增：设备状态；旧固件 / 20 字节包为 undefined */
  devStatus?: DeviceStatus;
  /** 原始 status 字节（无则 undefined） */
  statusByte?: number;
  /** 包版本：2 = 20 字节旧固件，3 = 21 字节，4 = 24 字节（带流状态） */
  version: 2 | 3 | 4;
  /** V4（24 字节包）：波形流状态位图 */
  streamState?: number;
  /** V4：最近 1 秒板载丢样数 —— 数据可信度的直接依据 */
  drop1s?: number;
}

/* ─── 帧类型判定（三端一致的唯一规则，见 PROTOCOL_V4.md §4）─── */

export type FrameKind = 'bio_pkt' | 'waveform' | 'stats' | 'unknown';

/**
 * 判定通知帧的类型。
 *
 * 规则（长度 + 首字节双重条件，任一条不满足即为 unknown）：
 *   len 20/21/24 且 buf[0] <= 220  → bio_pkt
 *   len >= 7     且 buf[0] == 0xE1 → waveform
 *   len == 32    且 buf[0] == 0xE2 → stats
 *   其它                            → unknown（**必须丢弃并计数**）
 *
 * 为什么必须这么严格：V3 的 parser 只判断 `length < 20`，于是 50 字节的
 * 0xEC 波形帧被当成生理数据解析（hr = 0xEC = 236），可能污染数据库。
 */
export function classifyFrame(data: Uint8Array): FrameKind {
  const n = data.length;
  if (n === 0) return 'unknown';
  const b0 = data[0];
  if ((n === PKT_LEN_V2 || n === PKT_LEN_V3 || n === PKT_LEN_V4) && b0 <= HR_SANITY_MAX) {
    return 'bio_pkt';
  }
  if (n >= WF_HDR_LEN && b0 === WF_MAGIC) return 'waveform';
  if (n === ST_LEN && b0 === ST_MAGIC) return 'stats';
  return 'unknown';
}

/* ─── V4 波形帧 ─── */

export interface WaveformFrame {
  signal: number;
  fmt: number;
  count: number;
  /** 本帧第一个点的绝对序号（每路信号独立、单调递增）——丢样检测的核心 */
  index: number;
  /** ECG：int16 采样值 */
  samples: Int16Array;
  /** PPG：ir/red 成对（严格时间对齐，便于比值法算 SpO2） */
  ir: Uint32Array;
  red: Uint32Array;
}

/** 解析 0xE1 波形帧；结构不符（长度/n/类型不匹配）返回 null。 */
export function parseWaveformFrame(data: Uint8Array): WaveformFrame | null {
  if (data.length < WF_HDR_LEN || data[0] !== WF_MAGIC) return null;
  const typeByte = data[1];
  const signal = typeByte & 0x0f;
  const fmt = (typeByte >> 4) & 0x0f;
  const count = data[2];
  if (count === 0) return null; // 协议上非法，宁可丢弃也不要"看似合法的空帧"
  const index =
    (data[3] | (data[4] << 8) | (data[5] << 16) | (data[6] << 24)) >>> 0;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const off = WF_HDR_LEN;

  if (signal === WF_SIG_ECG && fmt === WF_FMT_I16) {
    if (data.length !== off + count * 2) return null;
    const samples = new Int16Array(count);
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(off + i * 2, true);
    return { signal, fmt, count, index, samples, ir: new Uint32Array(0), red: new Uint32Array(0) };
  }

  if (signal === WF_SIG_PPG && fmt === WF_FMT_U32X2) {
    if (data.length !== off + count * 8) return null;
    const ir = new Uint32Array(count);
    const red = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      ir[i] = view.getUint32(off + i * 8, true);
      red[i] = view.getUint32(off + i * 8 + 4, true);
    }
    return { signal, fmt, count, index, samples: new Int16Array(0), ir, red };
  }

  return null; // 未知 signal/fmt
}

/* ─── V4 统计帧 ─── */

export interface StatsFrame {
  version: number;
  uptimeS: number;
  /** BMD101 UART 环形缓冲溢出**字节数**（线路层丢数据） */
  uartRxDrop: number;
  /** ECG 波形缓冲溢出**点数** */
  ecgStreamDrop: number;
  /** PPG 波形缓冲溢出**对数** */
  ppgStreamDrop: number;
  /** MAX30102 FIFO 溢出次数 */
  fifoOvf: number;
  /** 通知发送失败次数 */
  ntfErr: number;
  ecgRateHz: number;
  ppgRateHz: number;
  streamState: number;
  ecgDecim: number;
  chkFail: number;
}

export function parseStatsFrame(data: Uint8Array): StatsFrame | null {
  if (data.length !== ST_LEN || data[0] !== ST_MAGIC) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    version: data[1],
    uptimeS: view.getUint16(2, true),
    uartRxDrop: view.getUint32(4, true),
    ecgStreamDrop: view.getUint32(8, true),
    ppgStreamDrop: view.getUint32(12, true),
    fifoOvf: view.getUint32(16, true),
    ntfErr: view.getUint32(20, true),
    ecgRateHz: view.getUint16(24, true),
    ppgRateHz: view.getUint16(26, true),
    streamState: data[28],
    ecgDecim: data[29],
    chkFail: data[30],
  };
}

/**
 * 解析 20/21/24 字节 bio_pkt（小端）。
 *
 * **严格版**：长度必须是 20/21/24 且首字节 <= 220（心率上限），否则返回 null。
 * 这一条是防止"波形帧被当成生理数据"的关键 —— 见 classifyFrame 的说明。
 */
export function parseBioPkt(data: Uint8Array): BioPkt | null {
  if (classifyFrame(data) !== 'bio_pkt') return null;

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

  const version: 2 | 3 | 4 =
    data.length === PKT_LEN_V2 ? 2 : data.length === PKT_LEN_V3 ? 3 : 4;

  // 21/24 字节包的第 21 字节为设备状态位图；20 字节旧固件没有。
  let statusByte: number | undefined;
  let devStatus: DeviceStatus | undefined;
  if (data.length >= PKT_LEN_V3) {
    statusByte = data[20];
    devStatus = {
      sleConn: !!(statusByte & BIO_ST_SLE_CONN),
      bleConn: !!(statusByte & BIO_ST_BLE_CONN),
      paused: !!(statusByte & BIO_ST_PAUSED),
      maxOk: !!(statusByte & BIO_ST_MAX_OK),
      bmdOk: !!(statusByte & BIO_ST_BMD_OK),
      finger: !!(statusByte & BIO_ST_FINGER),
      ledOn: !!(statusByte & BIO_ST_LED_ON),
      ledManual: !!(statusByte & BIO_ST_LED_MANUAL),
    };
  }

  const pkt: BioPkt = {
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
    devStatus,
    statusByte,
    version,
  };

  // V4：24 字节包的额外 3 字节
  if (data.length === PKT_LEN_V4) {
    pkt.streamState = data[21];
    pkt.drop1s = view.getUint16(22, true);
  }
  return pkt;
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
 * 构造 CMD_STREAM 的 seq 值（哪几路波形要开）。
 */
export function streamSeq(ecg: boolean, ppg: boolean): number {
  return (ecg ? BIO_SS_ECG_ON : 0) | (ppg ? BIO_SS_PPG_ON : 0);
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
