/**
 * BIO HUB Cloud API Client
 *
 * Talks to the FastAPI backend at ``bio_hub_server/``. Handles:
 *   - Auth (register / login / me / change-password)
 *   - Session data upload (bulk measurements)
 *   - Analysis report retrieval
 *   - Server health check
 *   - Local report generation (offline fallback)
 *
 * Auth model:
 *   * A JWT bearer token is stored via ``authStore`` (src/auth.ts).
 *   * Endpoints that need auth automatically get an ``Authorization`` header.
 *   * A 401 response clears the local session so the UI can react.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authStore, AuthSession, AuthUser } from './auth';
import { Session, SessionStats, getSessionStats, getSessionMeasurements } from './storage';

/* ─── Types ─── */

export interface ServerConfig {
  baseUrl: string;
  timeout: number;
}

export interface UploadPayload {
  deviceName: string;
  deviceId: string;
  connectionType: string;
  startTime: number;
  endTime: number | null;
  measurements: MeasurementRow[];
}

export interface MeasurementRow {
  ts: number;
  hr: number;
  spo2: number;
  ir: number;
  tempC: number;
  pi: number;
  sbp: number;
  dbp: number;
  pttMs: number;
  ecgHr: number;
  ecgSig: number;
  ecgRaw: number;
  rrMs: number;
  flags: number;
}

export interface AnalysisReport {
  id: string;
  sessionId: number;
  createdAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  summary: string;
  healthScore: number;
  details: {
    hr: VitalAnalysis;
    spo2: VitalAnalysis;
    ecg: EcgAnalysis;
    bp: BpAnalysis;
    temp: VitalAnalysis;
  };
  recommendations: string[];
}

export interface VitalAnalysis {
  avg: number;
  min: number;
  max: number;
  stdDev: number;
  status: 'normal' | 'warning' | 'critical';
  message: string;
}

export interface EcgAnalysis {
  avgHr: number;
  hrv: number;
  rhythmStatus: string;
  signalQuality: string;
  status: 'normal' | 'warning' | 'critical';
  message: string;
}

export interface BpAnalysis {
  avgSbp: number;
  avgDbp: number;
  classification: string;
  status: 'normal' | 'warning' | 'critical';
  message: string;
}

export interface UploadResult {
  success: boolean;
  reportId?: string;
  message: string;
}

export interface ServerStatus {
  online: boolean;
  version?: string;
  message: string;
  latencyMs?: number;
}

export type UploadState = 'idle' | 'uploading' | 'success' | 'failed';

export interface UploadRecord {
  sessionId: number;
  state: UploadState;
  reportId?: string;
  uploadedAt?: number;
  error?: string;
}

/* ─── Constants ─── */

const CONFIG_KEY = '@biohub_server_config_v2';
const UPLOADS_KEY = '@biohub_upload_records';

const DEFAULT_CONFIG: ServerConfig = {
  // Ship with a default so first-run users can register immediately.
  baseUrl: 'http://156.226.176.22',
  timeout: 30000,
};

/* ─── Internal request result type ─── */

type Req<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
};

/* ─── API Client ─── */

class BioHubAPI {
  private config: ServerConfig = DEFAULT_CONFIG;
  private uploadRecords: Map<number, UploadRecord> = new Map();
  private initialized = false;

  /** Initialize: load config, upload records and auth session from storage. */
  async init(): Promise<void> {
    if (this.initialized) return;
    try {
      const configJson = await AsyncStorage.getItem(CONFIG_KEY);
      if (configJson) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(configJson) };
      }
      const uploadsJson = await AsyncStorage.getItem(UPLOADS_KEY);
      if (uploadsJson) {
        const arr: UploadRecord[] = JSON.parse(uploadsJson);
        arr.forEach((r) => this.uploadRecords.set(r.sessionId, r));
      }
      await authStore.init();
    } catch {}
    this.initialized = true;
  }

  /* ─── Config ─── */

  getConfig(): ServerConfig {
    return { ...this.config };
  }

  async setConfig(config: Partial<ServerConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
  }

  isConfigured(): boolean {
    return this.config.baseUrl.trim().length > 0;
  }

  /* ─── Auth passthrough ─── */

  getUser(): AuthUser | null {
    return authStore.getUser();
  }

  isAuthenticated(): boolean {
    return authStore.isAuthenticated();
  }

  /* ─── Upload records ─── */

  getUploadRecord(sessionId: number): UploadRecord | undefined {
    return this.uploadRecords.get(sessionId);
  }

  getAllUploadRecords(): UploadRecord[] {
    return Array.from(this.uploadRecords.values());
  }

  private async saveUploadRecords(): Promise<void> {
    const arr = Array.from(this.uploadRecords.values());
    await AsyncStorage.setItem(UPLOADS_KEY, JSON.stringify(arr));
  }

  /* ─── HTTP core ─── */

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    opts: { auth?: boolean } = {},
  ): Promise<Req<T>> {
    if (!this.isConfigured()) {
      return { ok: false, error: '未配置服务器地址' };
    }

    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (opts.auth !== false) {
      const token = authStore.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 401 && opts.auth !== false) {
        // Server rejected our token — force logout so the UI shows the login screen.
        await authStore.clear();
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = text || res.statusText;
        // FastAPI returns {"detail": "..."} on errors — surface it directly.
        try {
          const parsed = JSON.parse(text);
          if (parsed?.detail) msg = String(parsed.detail);
        } catch {}
        return { ok: false, error: msg, status: res.status };
      }

      const data = await res.json();
      return { ok: true, data, status: res.status };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { ok: false, error: '请求超时' };
      }
      return { ok: false, error: err?.message || '网络错误' };
    }
  }

  /* ─── Server status ─── */

  async checkServer(): Promise<ServerStatus> {
    if (!this.isConfigured()) {
      return { online: false, message: '未配置服务器地址' };
    }

    const start = Date.now();
    const result = await this.request<{ version?: string; status?: string }>(
      'GET',
      '/api/health',
      undefined,
      { auth: false },
    );
    const latencyMs = Date.now() - start;

    if (result.ok) {
      return {
        online: true,
        version: result.data?.version,
        message: '服务器连接正常',
        latencyMs,
      };
    }
    return { online: false, message: result.error || '无法连接到服务器' };
  }

  /* ─── Auth ─── */

  private async persistAuthResponse(data: any): Promise<AuthSession> {
    const session: AuthSession = {
      token: data.accessToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.displayName ?? null,
        isAdmin: !!data.user.isAdmin,
        createdAt: data.user.createdAt,
      },
      expiresAt: data.expiresAt,
    };
    await authStore.setSession(session);
    return session;
  }

  async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
    const result = await this.request<any>(
      'POST',
      '/api/auth/register',
      { email, password, displayName },
      { auth: false },
    );
    if (result.ok && result.data) {
      const session = await this.persistAuthResponse(result.data);
      return { ok: true, session };
    }
    return { ok: false, error: result.error };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ ok: boolean; session?: AuthSession; error?: string }> {
    const result = await this.request<any>(
      'POST',
      '/api/auth/login',
      { email, password },
      { auth: false },
    );
    if (result.ok && result.data) {
      const session = await this.persistAuthResponse(result.data);
      return { ok: true, session };
    }
    return { ok: false, error: result.error };
  }

  async logout(): Promise<void> {
    await authStore.clear();
  }

  async refreshMe(): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
    const result = await this.request<any>('GET', '/api/auth/me');
    if (result.ok && result.data) {
      const user: AuthUser = {
        id: result.data.id,
        email: result.data.email,
        displayName: result.data.displayName ?? null,
        isAdmin: !!result.data.isAdmin,
        createdAt: result.data.createdAt,
      };
      await authStore.updateUser(user);
      return { ok: true, user };
    }
    return { ok: false, error: result.error };
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const result = await this.request<any>('POST', '/api/auth/change-password', {
      currentPassword,
      newPassword,
    });
    if (result.ok) return { ok: true };
    return { ok: false, error: result.error };
  }

  /* ─── Upload session ─── */

  async uploadSession(session: Session): Promise<UploadResult> {
    if (!this.isAuthenticated()) {
      return { success: false, message: '请先登录后再上传' };
    }

    const record: UploadRecord = {
      sessionId: session.id,
      state: 'uploading',
    };
    this.uploadRecords.set(session.id, record);
    await this.saveUploadRecords();

    try {
      const measurements = await getSessionMeasurements(session.id);
      const payload: UploadPayload = {
        deviceName: session.deviceName,
        deviceId: session.deviceId,
        connectionType: session.connectionType,
        startTime: session.startTime,
        endTime: session.endTime,
        measurements: measurements.map((m: any) => ({
          ts: m.ts,
          hr: m.hr,
          spo2: m.spo2,
          ir: m.ir,
          tempC: m.temp_c,
          pi: m.pi,
          sbp: m.sbp,
          dbp: m.dbp,
          pttMs: m.ptt_ms,
          ecgHr: m.ecg_hr,
          ecgSig: m.ecg_sig,
          ecgRaw: m.ecg_raw,
          rrMs: m.rr_ms,
          flags: m.flags,
        })),
      };

      const result = await this.request<{ reportId: string; message: string }>(
        'POST',
        '/api/sessions/upload',
        payload,
      );

      if (result.ok && result.data) {
        record.state = 'success';
        record.reportId = result.data.reportId;
        record.uploadedAt = Date.now();
        this.uploadRecords.set(session.id, record);
        await this.saveUploadRecords();
        return {
          success: true,
          reportId: result.data.reportId,
          message: result.data.message || '上传成功',
        };
      }

      record.state = 'failed';
      record.error = result.error;
      this.uploadRecords.set(session.id, record);
      await this.saveUploadRecords();
      return { success: false, message: result.error || '上传失败' };
    } catch (err: any) {
      record.state = 'failed';
      record.error = err.message;
      this.uploadRecords.set(session.id, record);
      await this.saveUploadRecords();
      return { success: false, message: err.message || '上传异常' };
    }
  }

  /* ─── Reports ─── */

  async getReport(reportId: string): Promise<{ ok: boolean; report?: AnalysisReport; error?: string }> {
    const result = await this.request<AnalysisReport>('GET', `/api/reports/${reportId}`);
    if (result.ok && result.data) {
      return { ok: true, report: result.data };
    }
    return { ok: false, error: result.error };
  }

  async getReports(): Promise<{ ok: boolean; reports?: AnalysisReport[]; error?: string }> {
    const result = await this.request<{ reports: AnalysisReport[] }>('GET', '/api/reports');
    if (result.ok && result.data) {
      return { ok: true, reports: result.data.reports };
    }
    return { ok: false, error: result.error };
  }

  /* ─── Offline / Mock Report Generation ─── */

  /**
   * Generate a local analysis report from session data.
   * Used when no server is available — provides basic analysis
   * that can be enhanced later with server-side AI analysis.
   */
  async generateLocalReport(sessionId: number): Promise<AnalysisReport | null> {
    const stats = await getSessionStats(sessionId);
    if (!stats) return null;

    const hrStatus = classifyHr(stats.hrAvg);
    const spo2Status = classifySpo2(stats.spo2Avg);
    const bpStatus = classifyBp(stats.sbpAvg, stats.dbpAvg);

    const healthScore = computeHealthScore(hrStatus, spo2Status, bpStatus);

    const recommendations: string[] = [];
    if (hrStatus.status !== 'normal') {
      recommendations.push(hrStatus.status === 'warning'
        ? '心率略有异常，建议关注休息和运动'
        : '心率异常明显，建议尽快就医检查');
    }
    if (spo2Status.status !== 'normal') {
      recommendations.push(spo2Status.status === 'warning'
        ? '血氧饱和度偏低，建议增加户外活动'
        : '血氧饱和度较低，建议就医检查');
    }
    if (bpStatus.status !== 'normal') {
      recommendations.push(bpStatus.status === 'warning'
        ? '血压略有偏高，建议调整饮食和作息'
        : '血压异常，建议就医检查');
    }
    if (recommendations.length === 0) {
      recommendations.push('各项指标正常，请继续保持良好的生活习惯');
    }

    return {
      id: `local_${sessionId}_${Date.now()}`,
      sessionId,
      createdAt: Date.now(),
      status: 'completed',
      summary: `本次采集 ${formatDurationShort(stats.duration)}，共 ${stats.packetCount} 个数据点。${healthScore >= 80 ? '整体状况良好。' : healthScore >= 60 ? '部分指标需要关注。' : '多项指标异常，请注意健康。'}`,
      healthScore,
      details: {
        hr: {
          avg: stats.hrAvg,
          min: stats.hrMin,
          max: stats.hrMax,
          stdDev: 0,
          ...hrStatus,
        },
        spo2: {
          avg: stats.spo2Avg,
          min: stats.spo2Min,
          max: stats.spo2Max,
          stdDev: 0,
          ...spo2Status,
        },
        ecg: {
          avgHr: stats.ecgHrAvg,
          hrv: 0,
          rhythmStatus: stats.ecgHrAvg > 0 ? '有数据' : '无有效数据',
          signalQuality: '本地分析不可用',
          status: 'normal' as const,
          message: 'ECG 深度分析需要服务器支持',
        },
        bp: {
          avgSbp: stats.sbpAvg,
          avgDbp: stats.dbpAvg,
          ...bpStatus,
        },
        temp: {
          avg: stats.tempAvg,
          min: stats.tempAvg,
          max: stats.tempAvg,
          stdDev: 0,
          status: stats.tempAvg > 37.5 ? 'warning' as const : 'normal' as const,
          message: stats.tempAvg > 37.5 ? '体温偏高' : '体温正常',
        },
      },
      recommendations,
    };
  }
}

/* ─── Classification Helpers ─── */

function classifyHr(avg: number): { status: 'normal' | 'warning' | 'critical'; message: string } {
  if (avg === 0) return { status: 'normal', message: '无有效数据' };
  if (avg >= 60 && avg <= 100) return { status: 'normal', message: '心率正常' };
  if ((avg >= 50 && avg < 60) || (avg > 100 && avg <= 120)) {
    return { status: 'warning', message: avg < 60 ? '心率偏慢' : '心率偏快' };
  }
  return { status: 'critical', message: avg < 50 ? '心率过慢' : '心率过快' };
}

function classifySpo2(avg: number): { status: 'normal' | 'warning' | 'critical'; message: string } {
  if (avg === 0) return { status: 'normal', message: '无有效数据' };
  if (avg >= 95) return { status: 'normal', message: '血氧正常' };
  if (avg >= 90) return { status: 'warning', message: '血氧偏低' };
  return { status: 'critical', message: '血氧过低' };
}

function classifyBp(sbp: number, dbp: number): {
  status: 'normal' | 'warning' | 'critical';
  classification: string;
  message: string;
} {
  if (sbp === 0 || dbp === 0) {
    return { status: 'normal', classification: '无数据', message: '无有效血压数据' };
  }
  if (sbp < 120 && dbp < 80) {
    return { status: 'normal', classification: '正常', message: '血压正常' };
  }
  if (sbp < 140 && dbp < 90) {
    return { status: 'warning', classification: '偏高', message: '血压偏高 (高血压前期)' };
  }
  return { status: 'critical', classification: '高血压', message: '血压异常 (高血压)' };
}

function computeHealthScore(
  hr: { status: string },
  spo2: { status: string },
  bp: { status: string },
): number {
  let score = 100;
  const deduct = (s: string, w: number, c: number) => {
    if (s === 'warning') score -= w;
    if (s === 'critical') score -= c;
  };
  deduct(hr.status, 10, 25);
  deduct(spo2.status, 15, 30);
  deduct(bp.status, 10, 25);
  return Math.max(0, Math.min(100, score));
}

function formatDurationShort(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}分钟`;
  const hours = Math.floor(mins / 60);
  return `${hours}小时${mins % 60}分钟`;
}

/* ─── Singleton Export ─── */

export const bioHubAPI = new BioHubAPI();
