/**
 * Real-time data analysis for BIO_HUB sensor data.
 * Provides live statistics computation and trend tracking.
 */
import { BioPkt } from './protocol';

export interface LiveStats {
  hrAvg: number;
  hrMin: number;
  hrMax: number;
  hrTrend: 'up' | 'down' | 'stable';
  spo2Avg: number;
  spo2Min: number;
  spo2Max: number;
  ecgHrAvg: number;
  ecgHrMin: number;
  ecgHrMax: number;
  sbpAvg: number;
  dbpAvg: number;
  tempAvg: number;
  piAvg: number;
  duration: number;
  sampleCount: number;
}

function avg(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function avgF(arr: number[], decimals = 1): number {
  if (!arr.length) return 0;
  const v = arr.reduce((a, b) => a + b, 0) / arr.length;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function trend(arr: number[], windowSize = 10): 'up' | 'down' | 'stable' {
  if (arr.length < windowSize * 2) return 'stable';
  const recent = arr.slice(-windowSize);
  const prev = arr.slice(-windowSize * 2, -windowSize);
  const recentAvg = avg(recent);
  const prevAvg = avg(prev);
  const diff = recentAvg - prevAvg;
  if (diff > 3) return 'up';
  if (diff < -3) return 'down';
  return 'stable';
}

export class LiveAnalyzer {
  private hrValues: number[] = [];
  private spo2Values: number[] = [];
  private ecgHrValues: number[] = [];
  /** 和波形同一套算法的心率。会话均值优先用它，芯片半拍/双拍不进均值。 */
  private wavePpgHr: number[] = [];
  private waveEcgHr: number[] = [];
  private sbpValues: number[] = [];
  private dbpValues: number[] = [];
  private tempValues: number[] = [];
  private piValues: number[] = [];
  private startTime: number = Date.now();

  /** Circular buffers for waveform display */
  private ecgBuffer: number[] = [];
  private hrBuffer: number[] = [];
  private spo2Buffer: number[] = [];

  private readonly WAVEFORM_SIZE = 200;

  reset(): void {
    this.hrValues = [];
    this.spo2Values = [];
    this.ecgHrValues = [];
    this.wavePpgHr = [];
    this.waveEcgHr = [];
    this.sbpValues = [];
    this.dbpValues = [];
    this.tempValues = [];
    this.piValues = [];
    this.ecgBuffer = [];
    this.hrBuffer = [];
    this.spo2Buffer = [];
    this.startTime = Date.now();
  }

  addPacket(pkt: BioPkt): void {
    if (pkt.hr > 0) this.hrValues.push(pkt.hr);
    if (pkt.spo2 > 0) this.spo2Values.push(pkt.spo2);
    // 芯片心率只在还没有波形心率时兜底。波形心率由 noteDisplayedHr 写入，
    // 会话均值用那一组，避免把 36 和 129 这种半拍/双拍算进平均值。
    if (pkt.ecgHr > 0 && pkt.ecgSig < 100) this.ecgHrValues.push(pkt.ecgHr);
    if (pkt.flags.pttValid && pkt.sbp > 0) this.sbpValues.push(pkt.sbp);
    if (pkt.flags.pttValid && pkt.dbp > 0) this.dbpValues.push(pkt.dbp);
    if (pkt.tempC > 0) this.tempValues.push(pkt.tempC);
    if (pkt.pi > 0) this.piValues.push(pkt.pi);

    this.ecgBuffer.push(pkt.ecgRaw);
    // 趋势优先画波形心率。还没有波形心率时，才用芯片值把线撑起来。
    if (this.wavePpgHr.length === 0 && pkt.hr > 0) this.hrBuffer.push(pkt.hr);
    if (pkt.spo2 > 0) this.spo2Buffer.push(pkt.spo2);

    if (this.ecgBuffer.length > this.WAVEFORM_SIZE) this.ecgBuffer.shift();
    if (this.hrBuffer.length > this.WAVEFORM_SIZE) this.hrBuffer.shift();
    if (this.spo2Buffer.length > this.WAVEFORM_SIZE) this.spo2Buffer.shift();
  }

  /**
   * 把和波形一致的心率记入会话均值。
   * 脉搏趋势也改画这一列，芯片的 36 / 129 不再把均值和箭头带偏。
   */
  noteDisplayedHr(kind: 'ecg' | 'ppg', bpm: number): void {
    if (!(bpm > 0) || !Number.isFinite(bpm)) return;
    if (kind === 'ppg') {
      if (this.wavePpgHr.length === 0) this.hrBuffer = [];
      this.wavePpgHr.push(bpm);
      this.hrBuffer.push(bpm);
      if (this.hrBuffer.length > this.WAVEFORM_SIZE) this.hrBuffer.shift();
      return;
    }
    this.waveEcgHr.push(bpm);
  }

  getStats(): LiveStats {
    const hrSrc = this.wavePpgHr.length >= 3 ? this.wavePpgHr : this.hrValues;
    const ecgSrc = this.waveEcgHr.length >= 3 ? this.waveEcgHr : this.ecgHrValues;
    return {
      hrAvg: avg(hrSrc),
      hrMin: hrSrc.length ? Math.min(...hrSrc) : 0,
      hrMax: hrSrc.length ? Math.max(...hrSrc) : 0,
      hrTrend: trend(hrSrc),
      spo2Avg: avg(this.spo2Values),
      spo2Min: this.spo2Values.length ? Math.min(...this.spo2Values) : 0,
      spo2Max: this.spo2Values.length ? Math.max(...this.spo2Values) : 0,
      ecgHrAvg: avg(ecgSrc),
      ecgHrMin: ecgSrc.length ? Math.min(...ecgSrc) : 0,
      ecgHrMax: ecgSrc.length ? Math.max(...ecgSrc) : 0,
      sbpAvg: avg(this.sbpValues),
      dbpAvg: avg(this.dbpValues),
      tempAvg: avgF(this.tempValues),
      piAvg: avgF(this.piValues),
      duration: (Date.now() - this.startTime) / 1000,
      sampleCount: this.hrValues.length,
    };
  }

  getEcgWaveform(): number[] {
    return [...this.ecgBuffer];
  }

  getHrTrend(): number[] {
    return [...this.hrBuffer];
  }

  getSpo2Trend(): number[] {
    return [...this.spo2Buffer];
  }
}

/**
 * 实时大数字用的短时中位数。
 *
 * 点采样大约每 500ms 来一包，瞬时值会跳，无效包又是 0。
 * 这里只收有效值，显示最近几秒的中位数；这段时间里没有新值时，
 * 继续把上一次的数留在屏幕上，避免格子长时间变成 "--"，也避免一闪一闪。
 */
export class HeldMedian {
  private samples: { t: number; v: number }[] = [];
  private held: { v: number; t: number } | null = null;

  constructor(
    private windowMs = 8000,
    private holdMs = 20000,
  ) {}

  push(v: number, now = Date.now()): void {
    if (!(v > 0) || !Number.isFinite(v)) return;
    this.samples.push({ t: now, v });
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }

  hasRecent(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    return this.samples.some((s) => s.t >= cutoff);
  }

  read(now = Date.now()): number | null {
    const cutoff = now - this.windowMs;
    const recent: number[] = [];
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].t >= cutoff) recent.push(this.samples[i].v);
    }
    if (recent.length) {
      recent.sort((a, b) => a - b);
      const med = recent[Math.floor(recent.length / 2)];
      this.held = { v: med, t: now };
      return med;
    }
    if (this.held && now - this.held.t <= this.holdMs) return this.held.v;
    return null;
  }

  reset(): void {
    this.samples = [];
    this.held = null;
  }
}

/** Format seconds into human-readable duration */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/** Format timestamp to readable date string */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
