/**
 * SQLite-based data storage for BIO_HUB sessions and measurements.
 * Uses expo-sqlite async API for persistent local storage.
 */
import * as SQLite from 'expo-sqlite';
import { BioPkt } from './protocol';

let db: SQLite.SQLiteDatabase | null = null;

export interface Session {
  id: number;
  deviceName: string;
  deviceId: string;
  connectionType: string;
  startTime: number;
  endTime: number | null;
  packetCount: number;
}

export interface SessionStats {
  hrAvg: number;
  hrMin: number;
  hrMax: number;
  spo2Avg: number;
  spo2Min: number;
  spo2Max: number;
  ecgHrAvg: number;
  sbpAvg: number;
  dbpAvg: number;
  tempAvg: number;
  piAvg: number;
  duration: number;
  packetCount: number;
}

export async function initDatabase(): Promise<void> {
  db = await SQLite.openDatabaseAsync('biohub.db');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      connection_type TEXT NOT NULL DEFAULT 'BLE',
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      packet_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      hr INTEGER DEFAULT 0,
      spo2 INTEGER DEFAULT 0,
      ir INTEGER DEFAULT 0,
      temp_c REAL DEFAULT 0,
      pi REAL DEFAULT 0,
      sbp INTEGER DEFAULT 0,
      dbp INTEGER DEFAULT 0,
      ptt_ms INTEGER DEFAULT 0,
      ecg_hr INTEGER DEFAULT 0,
      ecg_sig INTEGER DEFAULT 0,
      ecg_raw INTEGER DEFAULT 0,
      rr_ms INTEGER DEFAULT 0,
      flags INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_meas_session ON measurements(session_id);
    CREATE INDEX IF NOT EXISTS idx_meas_ts ON measurements(ts);
  `);
}

export function isReady(): boolean {
  return db !== null;
}

export async function createSession(
  deviceName: string,
  deviceId: string,
  connectionType: string,
): Promise<number> {
  if (!db) throw new Error('Database not initialized');
  const result = await db.runAsync(
    'INSERT INTO sessions (device_name, device_id, connection_type, start_time) VALUES (?, ?, ?, ?)',
    [deviceName, deviceId, connectionType, Date.now()],
  );
  return result.lastInsertRowId;
}

export async function endSession(sessionId: number): Promise<void> {
  if (!db) return;
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM measurements WHERE session_id = ?',
    [sessionId],
  );
  await db.runAsync(
    'UPDATE sessions SET end_time = ?, packet_count = ? WHERE id = ?',
    [Date.now(), row?.c ?? 0, sessionId],
  );
}

function packFlags(pkt: BioPkt): number {
  return (
    (pkt.flags.maxOk ? 1 : 0) |
    (pkt.flags.bmdOk ? 2 : 0) |
    (pkt.flags.finger ? 4 : 0) |
    (pkt.flags.pttValid ? 8 : 0)
  );
}

/** Insert a single measurement immediately */
export async function saveMeasurement(sessionId: number, pkt: BioPkt): Promise<void> {
  if (!db) return;
  await db.runAsync(
    `INSERT INTO measurements
       (session_id, ts, hr, spo2, ir, temp_c, pi, sbp, dbp, ptt_ms, ecg_hr, ecg_sig, ecg_raw, rr_ms, flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId, Date.now(),
      pkt.hr, pkt.spo2, pkt.ir, pkt.tempC, pkt.pi,
      pkt.sbp, pkt.dbp, pkt.pttMs, pkt.ecgHr, pkt.ecgSig, pkt.ecgRaw, pkt.rrMs,
      packFlags(pkt),
    ],
  );
}

/** Buffered insert — queues packets and flushes every 2 seconds for efficiency */
let insertBuffer: { sessionId: number; pkt: BioPkt; ts: number }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function queueMeasurement(sessionId: number, pkt: BioPkt): void {
  insertBuffer.push({ sessionId, pkt, ts: Date.now() });
  if (!flushTimer) {
    flushTimer = setTimeout(flushMeasurements, 2000);
  }
}

async function flushMeasurements(): Promise<void> {
  flushTimer = null;
  if (!db || insertBuffer.length === 0) return;
  const batch = insertBuffer.splice(0);
  for (const { sessionId, pkt, ts } of batch) {
    await db.runAsync(
      `INSERT INTO measurements
         (session_id, ts, hr, spo2, ir, temp_c, pi, sbp, dbp, ptt_ms, ecg_hr, ecg_sig, ecg_raw, rr_ms, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId, ts,
        pkt.hr, pkt.spo2, pkt.ir, pkt.tempC, pkt.pi,
        pkt.sbp, pkt.dbp, pkt.pttMs, pkt.ecgHr, pkt.ecgSig, pkt.ecgRaw, pkt.rrMs,
        packFlags(pkt),
      ],
    );
  }
}

export async function flushPending(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushMeasurements();
}

export async function getAllSessions(): Promise<Session[]> {
  if (!db) return [];
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM sessions ORDER BY start_time DESC',
  );
  return rows.map((r: any) => ({
    id: r.id,
    deviceName: r.device_name,
    deviceId: r.device_id,
    connectionType: r.connection_type,
    startTime: r.start_time,
    endTime: r.end_time,
    packetCount: r.packet_count,
  }));
}

export async function getSessionStats(sessionId: number): Promise<SessionStats | null> {
  if (!db) return null;
  const row = await db.getFirstAsync<any>(
    `SELECT
       AVG(CASE WHEN hr > 0 THEN hr END) as hr_avg,
       MIN(CASE WHEN hr > 0 THEN hr END) as hr_min,
       MAX(CASE WHEN hr > 0 THEN hr END) as hr_max,
       AVG(CASE WHEN spo2 > 0 THEN spo2 END) as spo2_avg,
       MIN(CASE WHEN spo2 > 0 THEN spo2 END) as spo2_min,
       MAX(CASE WHEN spo2 > 0 THEN spo2 END) as spo2_max,
       AVG(CASE WHEN ecg_hr > 0 THEN ecg_hr END) as ecg_hr_avg,
       AVG(CASE WHEN sbp > 0 THEN sbp END) as sbp_avg,
       AVG(CASE WHEN dbp > 0 THEN dbp END) as dbp_avg,
       AVG(CASE WHEN temp_c > 0 THEN temp_c END) as temp_avg,
       AVG(CASE WHEN pi > 0 THEN pi END) as pi_avg,
       COUNT(*) as pkt_count,
       MIN(ts) as first_ts,
       MAX(ts) as last_ts
     FROM measurements WHERE session_id = ?`,
    [sessionId],
  );
  if (!row) return null;
  return {
    hrAvg: Math.round(row.hr_avg || 0),
    hrMin: row.hr_min || 0,
    hrMax: row.hr_max || 0,
    spo2Avg: Math.round(row.spo2_avg || 0),
    spo2Min: row.spo2_min || 0,
    spo2Max: row.spo2_max || 0,
    ecgHrAvg: Math.round(row.ecg_hr_avg || 0),
    sbpAvg: Math.round(row.sbp_avg || 0),
    dbpAvg: Math.round(row.dbp_avg || 0),
    tempAvg: Math.round((row.temp_avg || 0) * 10) / 10,
    piAvg: Math.round((row.pi_avg || 0) * 10) / 10,
    duration: ((row.last_ts || 0) - (row.first_ts || 0)) / 1000,
    packetCount: row.pkt_count || 0,
  };
}

export async function getSessionMeasurements(
  sessionId: number,
  limit?: number,
): Promise<any[]> {
  if (!db) return [];
  if (limit) {
    return db.getAllAsync<any>(
      'SELECT * FROM measurements WHERE session_id = ? ORDER BY ts DESC LIMIT ?',
      [sessionId, limit],
    );
  }
  return db.getAllAsync<any>(
    'SELECT * FROM measurements WHERE session_id = ? ORDER BY ts',
    [sessionId],
  );
}

export async function deleteSession(sessionId: number): Promise<void> {
  if (!db) return;
  await db.runAsync('DELETE FROM measurements WHERE session_id = ?', [sessionId]);
  await db.runAsync('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export async function clearAllData(): Promise<void> {
  if (!db) return;
  await db.execAsync('DELETE FROM measurements; DELETE FROM sessions;');
}

export async function exportSessionCSV(sessionId: number): Promise<string> {
  if (!db) return '';
  const session = await db.getFirstAsync<any>(
    'SELECT * FROM sessions WHERE id = ?',
    [sessionId],
  );
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM measurements WHERE session_id = ? ORDER BY ts',
    [sessionId],
  );
  let csv = `# BIO HUB Session Export\n`;
  csv += `# Device: ${session?.device_name || 'Unknown'}\n`;
  csv += `# Connection: ${session?.connection_type || 'BLE'}\n`;
  csv += `# Start: ${new Date(session?.start_time || 0).toISOString()}\n`;
  csv += `# Packets: ${rows.length}\n\n`;
  csv += 'timestamp,hr,spo2,ir,temp_c,pi,sbp,dbp,ptt_ms,ecg_hr,ecg_sig,ecg_raw,rr_ms,flags\n';
  csv += rows
    .map(
      (r: any) =>
        `${new Date(r.ts).toISOString()},${r.hr},${r.spo2},${r.ir},${r.temp_c},${r.pi},${r.sbp},${r.dbp},${r.ptt_ms},${r.ecg_hr},${r.ecg_sig},${r.ecg_raw},${r.rr_ms},${r.flags}`,
    )
    .join('\n');
  return csv;
}
