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
   * 界面上那条旧的"ECG 波形"来自 bio_pkt.ecgRaw（每 500ms 一个点 ≈2Hz），
   * 只能看趋势；这里给的是真正的采样波形。
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

/**
 * 从最近一段单通道波形估心率（bpm）。
 *
 * 给 App 实时显示用：芯片心率在信号质量 200 时仍可能吐出一个数，
 * 这里用波形自己的峰间距再算一次，和血氧心率对照。
 * 不应期 400ms，避免重搏切迹被计成第二次心跳。
 * 样本不够、峰太少、间期太散或心率超出 40–180 时返回 null。
 */
export function estimateHrBpm(samples: ArrayLike<number>, fs: number): number | null {
  if (!(fs >= 20) || samples.length < fs * 6) return null;
  const n = Math.min(samples.length, Math.floor(fs * 10));
  const start = samples.length - n;
  const dev = new Array<number>(n);
  let base = Number(samples[start]);
  for (let i = 0; i < n; i++) {
    const v = Number(samples[start + i]);
    base += (v - base) / 64;
    dev[i] = v - base;
  }
  let mad = 1;
  for (let i = 0; i < n; i++) {
    mad += (Math.abs(dev[i]) - mad) / 32;
  }
  const thr = Math.max(mad * 3, 1);
  const refr = Math.max(2, Math.ceil(0.4 * fs));
  const peaks: number[] = [];
  let i = 1;
  while (i < n - 1) {
    const a = Math.abs(dev[i]);
    if (a >= thr && a >= Math.abs(dev[i - 1]) && a >= Math.abs(dev[i + 1])) {
      peaks.push(i);
      i += refr;
    } else {
      i++;
    }
  }
  if (peaks.length < 5) return null;
  const rr: number[] = [];
  for (let k = 1; k < peaks.length; k++) {
    rr.push((peaks[k] - peaks[k - 1]) / fs);
  }
  rr.sort((a, b) => a - b);
  const med = rr[Math.floor(rr.length / 2)];
  if (!(med > 0)) return null;
  const hr = 60 / med;
  if (hr < 40 || hr > 180) return null;
  if (rr[rr.length - 1] - rr[0] > med * 0.8) return null;
  return Math.round(hr);
}
