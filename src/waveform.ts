/**
 * 波形流重组器（协议 v4，App 侧）。
 *
 * 与 `fbb_ws63_v2/tools/proto/decoder.py` 的 `WaveformAssembler` 语义**完全一致**
 * —— 两侧都有测试对着同一份 `vectors.json` 跑，任何一侧偏离都会被测出来。
 *
 * 职责：
 *   1. 按帧头的 `index` 把样本落位（而不是"按到达顺序拼起来"）；
 *   2. 用 index 缺口**精确量化丢样**（v3 完全做不到，这是 v4 的核心价值）；
 *   3. 把板载统计帧（0xE2）的计数器一并留存，作为会话质量元数据上传；
 *   4. 识别"速率切换导致 index 归零"（是新的段，不是丢样）。
 */
import { StatsFrame, WaveformFrame, WF_SIG_ECG, WF_SIG_PPG } from './protocol';
// pako：纯 JS 的 zlib 实现。**不能用 Node 的 zlib**——React Native 里没有它，
// 而服务器要求载荷是 zlib 压缩后的样本（见 bio_hub_server/app/waveform.py）。
import pako from 'pako';

export interface SignalTrack {
  name: 'ecg' | 'ppg';
  /** 名义采样率（来自统计帧；未知时为 0） */
  nominalHz: number;
  /** ECG 样本（int16） */
  samples: number[];
  /** PPG 红外通道 */
  ir: number[];
  /** PPG 红光通道（与 ir 严格同刻，比值法算 SpO2 依赖这一点） */
  red: number[];
  firstIndex: number | null;
  nextIndex: number | null;
  frames: number;
  receivedPoints: number;
  /** 由 index 缺口推出的丢样点数 */
  gapPoints: number;
  /** 速率切换次数（index 回退） */
  rateResets: number;
  /**
   * 固件上报的 index 与"实收点数"之间的总落差。
   *
   * 为什么需要它：index 取的是固件 ring 的**弹出计数**，ring 溢出丢样时
   * index 不会跳过被丢掉的量（见 hub_ble/sensor_hub 的 index 缺陷）。
   * 因此当服务器看到 (nextIndex - firstIndex) 明显大于 receivedPoints 时，
   * 会认为"中间丢了 (nextIndex-firstIndex) - receivedPoints 个点"。
   * 这里把同样的量算出来随上传一起报，双方口径一致、不会互相误判。
   */
  aggregateIndexGap: number;
}

function emptyTrack(name: 'ecg' | 'ppg'): SignalTrack {
  return {
    name,
    nominalHz: 0,
    samples: [],
    ir: [],
    red: [],
    firstIndex: null,
    nextIndex: null,
    frames: 0,
    receivedPoints: 0,
    gapPoints: 0,
    rateResets: 0,
    aggregateIndexGap: 0,
  };
}

export class WaveformAssembler {
  readonly tracks: { ecg: SignalTrack; ppg: SignalTrack } = {
    ecg: emptyTrack('ecg'),
    ppg: emptyTrack('ppg'),
  };
  /** 无法识别/畸形的帧（由 BLE 层传入的计数，便于统一上报） */
  unknownFrames = 0;
  malformedFrames = 0;
  bioPktCount = 0;
  /** 最近一次统计帧 */
  lastStats: StatsFrame | null = null;
  /**
   * 是否因为达到安全上限而停止累积样本。
   *
   * 为什么需要上限：样本以 JS number 存在数组里（8 字节/个），
   * 512Hz 录 1 小时就是 180 万个 ≈ 15MB，中低端机有被 OOM 杀掉的风险。
   * 上限取 15 分钟 @512Hz（= 460800 点，约 3.7MB）：
   * 覆盖任何合理的单次测量时长，且内存占用可控。
   * 触顶后**继续统计 index 缺口**（质量数据仍然完整），只是不再存样本，
   * 并把 truncated 标记上报，避免"看起来收了全程其实后半段没了"。
   */
  truncated = false;
  static readonly MAX_SAMPLES = 512 * 60 * 15;   // 15 分钟 @512Hz
  static readonly MAX_PPG_PAIRS = 200 * 60 * 15; // 15 分钟 @200Hz

  /** 统计帧：提供名义速率与板载丢样计数 */
  onStats(st: StatsFrame): void {
    this.lastStats = st;
    if (st.ecgRateHz > 0) this.tracks.ecg.nominalHz = st.ecgRateHz;
    if (st.ppgRateHz > 0) this.tracks.ppg.nominalHz = st.ppgRateHz;
  }

  /** 波形帧：按 index 落位并核算丢样 */
  onWaveform(fr: WaveformFrame): void {
    const tr = fr.signal === WF_SIG_ECG ? this.tracks.ecg : this.tracks.ppg;

    // index 回退 = 固件改速率/复位了流 → 视为新段，不计为丢样
    if (tr.nextIndex !== null && fr.index < tr.nextIndex) {
      tr.rateResets++;
      tr.nextIndex = fr.index;
    }
    if (tr.firstIndex === null) tr.firstIndex = fr.index;

    // 缺口就是丢样：这是"不说谎"的关键（v3 完全无法察觉）
    if (tr.nextIndex !== null && fr.index > tr.nextIndex) {
      tr.gapPoints += fr.index - tr.nextIndex;
    }

    tr.frames++;
    tr.receivedPoints += fr.count;
    tr.nextIndex = fr.index + fr.count;

    if (fr.signal === WF_SIG_ECG) {
      if (tr.samples.length < WaveformAssembler.MAX_SAMPLES) {
        for (let i = 0; i < fr.samples.length; i++) tr.samples.push(fr.samples[i]);
        if (tr.samples.length > WaveformAssembler.MAX_SAMPLES) {
          tr.samples.length = WaveformAssembler.MAX_SAMPLES;
          this.truncated = true;
        }
      } else {
        this.truncated = true;
      }
    } else {
      if (tr.ir.length < WaveformAssembler.MAX_PPG_PAIRS) {
        for (let i = 0; i < fr.ir.length; i++) {
          tr.ir.push(fr.ir[i]);
          tr.red.push(fr.red[i]);
        }
        if (tr.ir.length > WaveformAssembler.MAX_PPG_PAIRS) {
          tr.ir.length = WaveformAssembler.MAX_PPG_PAIRS;
          tr.red.length = WaveformAssembler.MAX_PPG_PAIRS;
          this.truncated = true;
        }
      } else {
        this.truncated = true;
      }
    }
    // 累计"index 跨度 − 实收点数"（见 SignalTrack.aggregateIndexGap 的说明）。
    // 固件 ring 溢出时 index 不跳过丢弃量，这个差值就是那部分不可见的丢样。
    if (tr.firstIndex !== null && tr.nextIndex !== null) {
      const gap = tr.nextIndex - tr.firstIndex - tr.receivedPoints;
      tr.aggregateIndexGap = gap > 0 ? gap : 0;
    }
  }

  /**
   * 界面显示用的"最近 n 个 ECG 点"（真实 512Hz 波形，不是 ecgRaw 瞬时值）。
   * 实时页请用 liveTrace：固定看最近几秒，而不是固定 480 点（512Hz 下不到 1 秒，只能看见一个心拍）。
   */
  ecgWindow(n = 480): number[] {
    const s = this.tracks.ecg.samples;
    return s.length <= n ? s.slice() : s.slice(s.length - n);
  }

  /** 收到的波形帧总数（ECG + PPG）。用于判断"流是否真的在来数据" */
  waveformFrames(): number {
    return this.tracks.ecg.frames + this.tracks.ppg.frames;
  }

  /** 会话结束时的质量摘要（随上传一并提交，服务器据此决定能否出结论） */
  summary(): SessionQuality {
    const pack = (tr: SignalTrack) => {
      const expected =
        tr.firstIndex !== null && tr.nextIndex !== null ? tr.nextIndex - tr.firstIndex : 0;
      const lossPct = expected > 0 ? (100 * tr.gapPoints) / expected : 0;
      const effectiveHz = expected > 0 ? (tr.nominalHz * tr.receivedPoints) / expected : 0;
      return {
        nominalHz: tr.nominalHz,
        effectiveHz: Math.round(effectiveHz * 100) / 100,
        frames: tr.frames,
        receivedPoints: tr.receivedPoints,
        expectedPoints: expected,
        lostPoints: tr.gapPoints,
        lossPct: Math.round(lossPct * 1000) / 1000,
        rateResets: tr.rateResets,
        aggregateIndexGap: tr.aggregateIndexGap,
      };
    };
    const st = this.lastStats;
    return {
      ecg: pack(this.tracks.ecg),
      ppg: pack(this.tracks.ppg),
      unknownFrames: this.unknownFrames,
      malformedFrames: this.malformedFrames,
      truncated: this.truncated,
      onboard: st
        ? {
            uartRxDrop: st.uartRxDrop,
            ecgStreamDrop: st.ecgStreamDrop,
            ppgStreamDrop: st.ppgStreamDrop,
            fifoOvf: st.fifoOvf,
            ntfErr: st.ntfErr,
            chkFail: st.chkFail,
          }
        : null,
    };
  }

  reset(): void {
    this.tracks.ecg = emptyTrack('ecg');
    this.tracks.ppg = emptyTrack('ppg');
    this.unknownFrames = 0;
    this.malformedFrames = 0;
    this.bioPktCount = 0;
    this.lastStats = null;
    this.truncated = false;
  }
}

export interface SignalQuality {
  nominalHz: number;
  effectiveHz: number;
  frames: number;
  receivedPoints: number;
  expectedPoints: number;
  lostPoints: number;
  lossPct: number;
  rateResets: number;
  /**
   * index 跨度 − 实收点数。固件 ring 溢出时 index 不跳过丢弃量，
   * 这部分是"index 缺口看不见的丢样"；上传时与服务器口径保持一致。
   */
  aggregateIndexGap?: number;
}

export interface SessionQuality {
  ecg: SignalQuality;
  ppg: SignalQuality;
  unknownFrames: number;
  malformedFrames: number;
  /** 是否因达到内存上限而截断了样本（截断后质量计数仍完整） */
  truncated?: boolean;
  onboard: {
    uartRxDrop: number;
    ecgStreamDrop: number;
    ppgStreamDrop: number;
    fifoOvf: number;
    ntfErr: number;
    chkFail: number;
  } | null;
}

/**
 * 把 int16 样本压成小端字节流（上传用）。
 * 与服务器端的解码约定一致：int16 LE，连续排列。
 */
export function packInt16LE(values: number[] | Int16Array): Uint8Array {
  const n = values.length;
  const out = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    const v = values[i] & 0xffff;
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return out;
}

/** 把 PPG 的 ir/red 交错压成小端 u32 对（上传用） */
export function packU32PairsLE(ir: number[] | Uint32Array, red: number[] | Uint32Array): Uint8Array {
  const n = Math.min(ir.length, red.length);
  const out = new Uint8Array(n * 8);
  const view = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    view.setUint32(i * 8, ir[i] >>> 0, true);
    view.setUint32(i * 8 + 4, red[i] >>> 0, true);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════
 * 上传序列化：与服务器 app/waveform.py 的解码约定严格对应
 *   ECG 载荷 = int16 小端连续    → zlib → base64
 *   PPG 载荷 = u32 小端 (ir,red) 成对 → zlib → base64
 *
 * 为什么不用 Node 的 Buffer / zlib：
 *   React Native 里没有这两个模块。base64 用查表手写、压缩用 pako，
 *   这样同一份代码在 App 与 Node 测试脚本里跑出来的字节完全一致。
 * ══════════════════════════════════════════════════════════════════════ */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 纯 JS 的 base64 编码（不依赖 Buffer，RN 与 Node 通用） */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_CHARS[(x >> 18) & 63] + B64_CHARS[(x >> 12) & 63]
         + B64_CHARS[(x >> 6) & 63] + B64_CHARS[x & 63];
  }
  const rest = n - i;
  if (rest === 1) {
    const x = bytes[i] << 16;
    out += B64_CHARS[(x >> 18) & 63] + B64_CHARS[(x >> 12) & 63] + '==';
  } else if (rest === 2) {
    const x = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_CHARS[(x >> 18) & 63] + B64_CHARS[(x >> 12) & 63]
         + B64_CHARS[(x >> 6) & 63] + '=';
  }
  return out;
}

/** 服务器视角的波形段（与 bio_hub_server/app/schemas.py 的 WaveformIn 对应） */
export interface WaveformUpload {
  signal: number;   // 1 = ECG, 2 = PPG
  fmt: number;      // 1 = I16, 5 = U32X2
  fsHz: number;
  index0: number;
  count: number;
  dataB64: string;
}

/* ── 会话 → 波形载荷的缓存 ──────────────────────────────────────────────
 *
 * 为什么需要它：录制发生在 DeviceScreen（那里持有 WaveformAssembler），
 * 而"上传"这个动作可能来自 HistoryScreen 的按钮，跨了组件。
 * 把序列化好的载荷按 sessionId 存这里，两个界面都不用互相引用。
 *
 * 权衡与已知限制：**只存在内存里**。App 被杀掉后，本地库里仍有点采样
 * （measurements），但波形段会丢，上传时就不带 waveforms —— 服务器照常
 * 出规则报告，只是没有波形分析。波形本身没有额外入库，因为 512Hz×10min
 * 的原始样本对手机 SQLite 太重；要跨重启保留需要另做"回传即用即传"。
 * ──────────────────────────────────────────────────────────────────── */
const pendingWaveforms = new Map<number, { waveforms: WaveformUpload[]; quality: QualityUpload }>();

export function stashSessionWaveforms(
  sessionId: number,
  waveforms: WaveformUpload[],
  quality: QualityUpload,
): void {
  pendingWaveforms.set(sessionId, { waveforms, quality });
}

export function takeSessionWaveforms(
  sessionId: number,
): { waveforms: WaveformUpload[]; quality: QualityUpload } | undefined {
  return pendingWaveforms.get(sessionId);
}

export function dropSessionWaveforms(sessionId: number): void {
  pendingWaveforms.delete(sessionId);
}

export interface QualityUpload {
  ecgNominalHz: number;
  ecgReceivedPoints: number;
  ecgExpectedPoints: number;
  ecgLostPoints: number;
  ecgRateResets: number;
  ppgNominalHz: number;
  ppgReceivedPoints: number;
  ppgExpectedPoints: number;
  ppgLostPoints: number;
  ppgRateResets: number;
  unknownFrames: number;
  malformedFrames: number;
  onboardUartRxDrop: number;
  onboardEcgStreamDrop: number;
  onboardPpgStreamDrop: number;
  onboardFifoOvf: number;
  onboardNtfErr: number;
  onboardChkFail: number;
}

/**
 * 把本次会话累计的波形整段序列化成上传载荷。
 *
 * 约定：**每个信号一段**（index0 = 该路第一帧的序号，count = 实收点数）。
 * 服务器会按 `index0 + count` 与"下一段的 index0"比对，独立核算缺口 ——
 * 所以这里绝不能把 index 重排或填补，否则等于替服务器撒谎。
 */
export function buildUploadPayloads(asm: WaveformAssembler): WaveformUpload[] {
  const out: WaveformUpload[] = [];

  const ecg = asm.tracks.ecg;
  if (ecg.receivedPoints > 0 && ecg.firstIndex !== null) {
    const packed = packInt16LE(ecg.samples);
    out.push({
      signal: WF_SIG_ECG,
      fmt: 1,
      fsHz: ecg.nominalHz || 512,
      index0: ecg.firstIndex,
      count: ecg.receivedPoints,
      dataB64: toBase64(pako.deflate(packed)),
    });
  }

  const ppg = asm.tracks.ppg;
  if (ppg.receivedPoints > 0 && ppg.firstIndex !== null) {
    const packed = packU32PairsLE(ppg.ir, ppg.red);
    out.push({
      signal: WF_SIG_PPG,
      fmt: 5,
      fsHz: ppg.nominalHz || 100,
      index0: ppg.firstIndex,
      count: ppg.receivedPoints,
      dataB64: toBase64(pako.deflate(packed)),
    });
  }
  return out;
}

/** 把 SessionQuality 转成服务器 SessionQualityIn 的字段名（camelCase） */
export function buildQualityUpload(q: SessionQuality): QualityUpload {
  const on = q.onboard;
  return {
    ecgNominalHz: q.ecg.nominalHz,
    ecgReceivedPoints: q.ecg.receivedPoints,
    ecgExpectedPoints: q.ecg.expectedPoints,
    ecgLostPoints: q.ecg.lostPoints,
    ecgRateResets: q.ecg.rateResets,
    ppgNominalHz: q.ppg.nominalHz,
    ppgReceivedPoints: q.ppg.receivedPoints,
    ppgExpectedPoints: q.ppg.expectedPoints,
    ppgLostPoints: q.ppg.lostPoints,
    ppgRateResets: q.ppg.rateResets,
    unknownFrames: q.unknownFrames,
    malformedFrames: q.malformedFrames,
    onboardUartRxDrop: on?.uartRxDrop ?? 0,
    onboardEcgStreamDrop: on?.ecgStreamDrop ?? 0,
    onboardPpgStreamDrop: on?.ppgStreamDrop ?? 0,
    onboardFifoOvf: on?.fifoOvf ?? 0,
    onboardNtfErr: on?.ntfErr ?? 0,
    onboardChkFail: on?.chkFail ?? 0,
  };
}

/** 实时波形横轴：最近 8 秒。512Hz 下大约能看到 8～10 个心拍，而不是一个。 */
export const LIVE_TRACE_SECONDS = 8;
const LIVE_TRACE_POINTS = 720;

function tailSamples(samples: ArrayLike<number>, n: number): number[] {
  const len = samples.length;
  const count = Math.min(len, n);
  const start = len - count;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = Number(samples[start + i]);
  return out;
}

/**
 * 按时间抽成固定点数，每个桶保留最小值和最大值。
 * 心电的 R 峰很窄，等间隔抽点会把它抽没；先取极值再画，峰还在。
 */
function decimateMinMax(data: number[], target: number): number[] {
  if (data.length <= target) return data;
  const pairs = Math.max(1, Math.floor(target / 2));
  const bucket = data.length / pairs;
  const out: number[] = [];
  for (let i = 0; i < pairs; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(data.length, Math.max(start + 1, Math.floor((i + 1) * bucket)));
    let min = data[start];
    let max = data[start];
    let minAt = start;
    let maxAt = start;
    for (let j = start + 1; j < end; j++) {
      const v = data[j];
      if (v < min) {
        min = v;
        minAt = j;
      }
      if (v > max) {
        max = v;
        maxAt = j;
      }
    }
    if (minAt <= maxAt) out.push(min, max);
    else out.push(max, min);
  }
  return out;
}

/**
 * 和 dev/scripts/live_bio_plot.py 同一套显示滤波，只作用于画出的这一小段。
 * 心电：3 阶巴特沃斯 0.5–40 Hz，再陷 50 Hz（Q=30），采样率 512。
 * 脉搏：3 阶巴特沃斯 0.5–8 Hz，采样率 100。
 * 系数由 scipy.signal.butter / iirnotch 算出。零相位（正反各滤一次），
 * 否则 8 秒窗口两头会翘起来。滤波前先减掉这一窗的均值：
 * 这套系数从零状态起步，脉搏直流有十几万，不减的话开头会冲出几万，
 * 真脉搏就被画成一条直线。心率估计仍用原始样本，不经过这里。
 */
const ECG_BAND_SOS = [
  [0.0092603562, 0.0185207124, 0.0092603562, 1, -1.4360096134, 0.6258554706],
  [1, 0, -1, 1, -1.6010920356, 0.6035547643],
  [1, -2, 1, 1, -1.9939222928, 0.9939602768],
];
const ECG_NOTCH_SOS = [
  [0.9898766355, -1.6186162081, 0.9898766355, 1, -1.6186162081, 0.979753271],
];
const PPG_BAND_SOS = [
  [0.0085986861, 0.0171973722, 0.0085986861, 1, -1.4543775493, 0.6486481864],
  [1, 0, -1, 1, -1.5998427471, 0.6128007881],
  [1, -2, 1, 1, -1.9702236431, 0.971247856],
];

function sosfilt(sos: number[][], x: number[]): number[] {
  let y = x;
  for (let s = 0; s < sos.length; s++) {
    const sec = sos[s];
    const a0 = sec[3] || 1;
    const b0 = sec[0] / a0;
    const b1 = sec[1] / a0;
    const b2 = sec[2] / a0;
    const a1 = sec[4] / a0;
    const a2 = sec[5] / a0;
    const out = new Array<number>(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xn = y[i];
      const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xn;
      y2 = y1;
      y1 = yn;
      out[i] = yn;
    }
    y = out;
  }
  return y;
}

function filtfilt(sos: number[][], x: number[]): number[] {
  if (x.length < 12) return x.slice();
  const pad = Math.min(x.length - 1, 3 * sos.length * 2);
  const ext = new Array<number>(x.length + pad * 2);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  for (let i = 0; i < x.length; i++) ext[pad + i] = x[i];
  const last = x.length - 1;
  for (let i = 0; i < pad; i++) ext[pad + x.length + i] = 2 * x[last] - x[last - 1 - i];
  const fwd = sosfilt(sos, ext);
  fwd.reverse();
  const back = sosfilt(sos, fwd);
  back.reverse();
  return back.slice(pad, pad + x.length);
}

function displayFilter(data: number[], kind: 'ecg' | 'ppg'): number[] {
  if (data.length < 12) return data.slice();
  // 滤波从零状态起步。脉搏红外直流大约十几万，不先减掉的话，
  // 开头会冲出几万个计数，再按最大绝对值铺满纵坐标，真脉搏（几百个计数）就看成一条直线。
  // 带通本来就会去掉直流；scipy 的 filtfilt 用初始状态避开了这一下，这里减窗口均值，效果一样。
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  const centered = new Array<number>(data.length);
  for (let i = 0; i < data.length; i++) centered[i] = data[i] - mean;
  if (kind === 'ecg') return filtfilt(ECG_NOTCH_SOS, filtfilt(ECG_BAND_SOS, centered));
  return filtfilt(PPG_BAND_SOS, centered);
}

/**
 * 实时波形：取最近 LIVE_TRACE_SECONDS 秒，按观察脚本滤一遍，再抽到画布点数。
 */
export function liveTrace(
  samples: ArrayLike<number>,
  fs: number,
  kind: 'ecg' | 'ppg' = 'ecg',
): number[] {
  if (!(fs >= 1) || samples.length < 2) return [];
  const n = Math.min(samples.length, Math.round(fs * LIVE_TRACE_SECONDS));
  const data = displayFilter(tailSamples(samples, n), kind);
  return decimateMinMax(data, LIVE_TRACE_POINTS);
}

type Peak = { i: number; h: number };

/**
 * 靠得太近的两个峰只留更高的那个。
 * 心电的 T 波、脉搏的重搏切迹会在一次搏动里再冒一个矮峰，
 * 不丢掉的话心率会变成两倍（画面上仍是正常心拍）。
 */
function pruneClosePeaks(peaks: Peak[], fs: number): Peak[] {
  const minGap = Math.ceil(0.36 * fs);
  const kept = peaks.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 1; k < kept.length; k++) {
      if (kept[k].i - kept[k - 1].i >= minGap) continue;
      kept.splice(kept[k].h < kept[k - 1].h ? k : k - 1, 1);
      changed = true;
      break;
    }
  }
  if (kept.length < 6) return kept;
  const heights = kept.map((p) => p.h).sort((a, b) => a - b);
  const mid = heights[Math.floor(heights.length / 2)];
  const tall = kept.filter((p) => p.h >= mid * 0.65);
  return tall.length >= 4 ? tall : kept;
}

function hrFromPeaks(peaks: Peak[], fs: number): number | null {
  if (peaks.length < 4) return null;
  const rr: number[] = [];
  for (let k = 1; k < peaks.length; k++) {
    rr.push((peaks[k].i - peaks[k - 1].i) / fs);
  }
  rr.sort((a, b) => a - b);
  const med = rr[Math.floor(rr.length / 2)];
  if (!(med > 0)) return null;
  let near = 0;
  for (let k = 0; k < rr.length; k++) {
    if (rr[k] > med * 0.6 && rr[k] < med * 1.4) near++;
  }
  if (near < 4) return null;
  const hr = 60 / med;
  if (hr < 40 || hr > 180) return null;
  return Math.round(hr);
}

/**
 * 用自相关找这一窗的重复周期。
 * 漏掉一两拍、或最高的一拍特别高时，逐拍找峰会把间期拉长，心率掉到三十多。
 * 周期对得上的位置相关最强。若两倍周期也差不多强，取更短的那个，避免把两拍当成一拍。
 */
function hrFromPeriod(y: number[], fs: number): number | null {
  const n = y.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += y[i] * y[i];
  if (!(energy > 1)) return null;
  const minLag = Math.round(fs * 0.33);
  const maxLag = Math.min(n - 4, Math.round(fs * 1.5));
  if (maxLag <= minLag + 2) return null;
  const ac = new Array<number>(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    const m = n - lag;
    for (let i = 0; i < m; i++) c += y[i] * y[i + lag];
    ac[lag] = c / energy;
  }
  let best = 0;
  let bestLag = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const norm = ac[lag];
    if (norm >= ac[lag - 1] && norm > ac[lag + 1] && norm > best && norm >= 0.2) {
      best = norm;
      bestLag = lag;
    }
  }
  if (!bestLag) return null;
  const half = Math.round(bestLag / 2);
  if (half >= minLag && ac[half] >= best * 0.65) bestLag = half;
  const hr = 60 / (bestLag / fs);
  if (hr < 40 || hr > 180) return null;
  return Math.round(hr);
}

/**
 * 漏掉的拍会把间期拉到 1 秒以上，全部取中位数心率就偏低。
 * 只留彼此相差不超过约 18% 的那一簇，用这一簇的中位数。
 */
function hrFromCluster(rrSec: number[]): { hr: number; n: number } | null {
  const xs = rrSec.filter((r) => r > 0.38 && r < 1.45).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  let bestN = 0;
  let bestMed = 0;
  for (let i = 0; i < xs.length; i++) {
    const c = xs[i];
    const sel: number[] = [];
    for (let j = 0; j < xs.length; j++) {
      if (xs[j] > c * 0.85 && xs[j] < c * 1.18) sel.push(xs[j]);
    }
    if (sel.length > bestN) {
      bestN = sel.length;
      bestMed = sel[Math.floor(sel.length / 2)];
    }
  }
  if (bestN < 3 || !(bestMed > 0)) return null;
  const hr = Math.round(60 / bestMed);
  if (hr < 40 || hr > 160) return null;
  return { hr, n: bestN };
}

/** 突出度够的局部峰。朝上、朝下各走一次，收缩峰朝下时也不会整拍漏掉。 */
function promIntervals(y: number[], fs: number): number[] {
  let mean = 0;
  for (let i = 0; i < y.length; i++) mean += y[i];
  mean /= y.length;
  let varSum = 0;
  for (let i = 0; i < y.length; i++) {
    const d = y[i] - mean;
    varSum += d * d;
  }
  const sd = Math.sqrt(varSum / y.length) || 1;
  const z = new Array<number>(y.length);
  for (let i = 0; i < y.length; i++) z[i] = (y[i] - mean) / sd;
  const dist = Math.max(2, Math.round(0.42 * fs));
  const span = dist * 2;
  const kept: number[] = [];
  for (let i = 1; i < z.length - 1; i++) {
    if (!(z[i] >= z[i - 1] && z[i] > z[i + 1] && z[i] > 0)) continue;
    const lo = Math.max(0, i - span);
    const hi = Math.min(z.length, i + 1 + span);
    if (i === lo || hi <= i + 1) continue;
    let leftMin = z[lo];
    for (let k = lo + 1; k < i; k++) if (z[k] < leftMin) leftMin = z[k];
    let rightMin = z[i + 1];
    for (let k = i + 2; k < hi; k++) if (z[k] < rightMin) rightMin = z[k];
    if (z[i] - Math.max(leftMin, rightMin) < 0.35) continue;
    if (!kept.length || i - kept[kept.length - 1] >= dist) kept.push(i);
    else if (z[i] > z[kept[kept.length - 1]]) kept[kept.length - 1] = i;
  }
  const rr: number[] = [];
  for (let k = 1; k < kept.length; k++) rr.push((kept[k] - kept[k - 1]) / fs);
  return rr;
}

function choosePpgHr(cands: { hr: number; n: number }[]): number | null {
  if (!cands.length) return null;
  cands.sort((a, b) => b.n - a.n || a.hr - b.hr);
  if (cands.length === 1) return cands[0].hr;
  const h1 = cands[0];
  const h2 = cands[1];
  const lo = h1.hr < h2.hr ? h1.hr : h2.hr;
  const hi = h1.hr < h2.hr ? h2.hr : h1.hr;
  if (lo < 55 && hi >= lo * 1.5 && hi <= 110 && hi <= lo * 2.1) return Math.round(hi);
  if (h1.n >= h2.n + 2) return h1.hr;
  if (Math.abs(h1.hr - h2.hr) <= 12) return Math.round((h1.hr + h2.hr) / 2);
  return h1.hr;
}

function ppgClusterBpm(filtered: number[], fs: number): number | null {
  const cands: { hr: number; n: number }[] = [];
  const up = hrFromCluster(promIntervals(filtered, fs));
  const down = hrFromCluster(promIntervals(filtered.map((v) => -v), fs));
  if (up) cands.push(up);
  if (down) cands.push(down);
  return choosePpgHr(cands);
}

/**
 * 从屏幕上这一段波形估心率（bpm）。
 *
 * 和 liveTrace 用同一套带通。心电先看重复周期，对不上再数峰（R 波取绝对值）。
 * 脉搏朝上朝下都数，并且只用间期靠得拢的那一簇：漏拍拉长的间隔不再把中位数拖低。
 * 样本不够或心率超出范围时返回 null。
 */
export function estimateHrBpm(
  samples: ArrayLike<number>,
  fs: number,
  kind: 'ecg' | 'ppg' = 'ecg',
): number | null {
  if (!(fs >= 20) || samples.length < fs * 6) return null;
  const n = Math.min(samples.length, Math.round(fs * LIVE_TRACE_SECONDS));
  const filtered = displayFilter(tailSamples(samples, n), kind);
  if (kind === 'ppg') {
    const clustered = ppgClusterBpm(filtered, fs);
    if (clustered != null) return clustered;
    const byPeriod = hrFromPeriod(filtered, fs);
    if (byPeriod != null && byPeriod >= 55) return byPeriod;
    return null;
  }
  const byPeriod = hrFromPeriod(filtered, fs);
  if (byPeriod != null) return byPeriod;
  let maxA = 0;
  for (let i = 0; i < filtered.length; i++) {
    const a = Math.abs(filtered[i]);
    if (a > maxA) maxA = a;
  }
  // R 波又高又窄，最大值的三成就能躲开 T 波。
  const thr = Math.max(maxA * 0.35, 1);
  const refr = Math.max(2, Math.ceil(0.28 * fs));
  const peaks: Peak[] = [];
  let i = 1;
  while (i < filtered.length - 1) {
    const a = Math.abs(filtered[i]);
    const left = Math.abs(filtered[i - 1]);
    const right = Math.abs(filtered[i + 1]);
    if (a >= thr && a >= left && a >= right && a > 0) {
      peaks.push({ i, h: a });
      i += refr;
    } else {
      i++;
    }
  }
  return hrFromPeaks(pruneClosePeaks(peaks, fs), fs);
}
