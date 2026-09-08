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
    if (pkt.ecgHr > 0) this.ecgHrValues.push(pkt.ecgHr);
    if (pkt.sbp > 0) this.sbpValues.push(pkt.sbp);
    if (pkt.dbp > 0) this.dbpValues.push(pkt.dbp);
    if (pkt.tempC > 0) this.tempValues.push(pkt.tempC);
    if (pkt.pi > 0) this.piValues.push(pkt.pi);

    this.ecgBuffer.push(pkt.ecgRaw);
    this.hrBuffer.push(pkt.hr);
    this.spo2Buffer.push(pkt.spo2);

    if (this.ecgBuffer.length > this.WAVEFORM_SIZE) this.ecgBuffer.shift();
    if (this.hrBuffer.length > this.WAVEFORM_SIZE) this.hrBuffer.shift();
    if (this.spo2Buffer.length > this.WAVEFORM_SIZE) this.spo2Buffer.shift();
  }

  getStats(): LiveStats {
    return {
      hrAvg: avg(this.hrValues),
      hrMin: this.hrValues.length ? Math.min(...this.hrValues) : 0,
      hrMax: this.hrValues.length ? Math.max(...this.hrValues) : 0,
      hrTrend: trend(this.hrValues),
      spo2Avg: avg(this.spo2Values),
      spo2Min: this.spo2Values.length ? Math.min(...this.spo2Values) : 0,
      spo2Max: this.spo2Values.length ? Math.max(...this.spo2Values) : 0,
      ecgHrAvg: avg(this.ecgHrValues),
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
