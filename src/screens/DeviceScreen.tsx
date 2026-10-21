/**
 * Connected device screen — live vitals, waveforms, statistics, BLE debug.
 *
 * Automatically records session data to SQLite when connected.
 *
 * Layout notes
 * ------------
 *  - `WAVEFORM_WIDTH` used to be computed once at module load from
 *    `Dimensions.get('window')`. That value is captured before the window is
 *    laid out and never updates, so the plots overflowed their card on any
 *    device whose metrics differed from the captured ones. Width now comes from
 *    the container's own `onLayout`.
 *  - The waveform info block was a `flexDirection: 'row'` container holding
 *    four stacked sentences. They were laid out side by side and ran off the
 *    right edge of the screen. It is a column again.
 *  - Metric cards no longer carry a 3px coloured left border. Eight accent
 *    colours as card chrome is decoration; the hues now live on the values and
 *    plot strokes, where they carry meaning.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Alert, LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Device } from 'react-native-ble-plx';
import { bioBleMgr, DiscoveryResult } from '../ble-manager';
import {
  BioPkt,
  ConnectionType,
  LED_MODE_AUTO,
  LED_MODE_ON,
  LED_MODE_OFF,
  LED_MODE_BLINK,
  LED_MODE_LABELS,
} from '../protocol';
import { HeldMedian, LiveAnalyzer, LiveStats, formatDuration } from '../analysis';
import { createSession, endSession, queueMeasurement, flushPending, isReady } from '../storage';
import {
  LIVE_TRACE_SECONDS,
  WaveformAssembler,
  buildUploadPayloads,
  buildQualityUpload,
  estimateHrBpm,
  liveTrace,
  stashSessionWaveforms,
} from '../waveform';
import { BIO_RATE_512_100 } from '../protocol';
import Waveform from '../components/Waveform';
import TabBar from '../components/TabBar';
import Icon from '../components/Icon';
import {
  Button,
  Card,
  DetailRow,
  MetricGrid,
  MetricGridItem,
  MetricTile,
  Pill,
  Screen,
  SectionTitle,
  StatCell,
  StatusBadge,
  useLargeText,
} from '../components/ui';
import { monoFont, radius, space, sunkenChrome, type, type Palette } from '../theme';
import { useTheme, useThemedStyles } from '../theme-context';

/**
 * 会话使用的采样率组合。
 *
 * BMD101 心电固定 512 SPS，这是芯片上限。2026-09-29 双通道 512+100 曾因
 * MAX30102 FIFO 溢出丢约 8%，所以当时降到 128+50。2026-10-09 在 PPG 按需上电、
 * 射频改 20ms 之后重测：双通道 512 Hz + 100 Hz，18 秒与 12 秒均丢点 0、通知失败 0。
 * App 侧重算心率不减少空中字节（压缩必须发生在发包之前），因此直接用这条已经
 * 测过的无损速率，不再为省带宽把心电抽成 128 Hz。
 */
const SESSION_RATE_CODE = BIO_RATE_512_100;
/** 固件 ecg_sig：0 最好。200 只表示芯片检峰没锁定，不代表波形里没有心拍。 */
const ECG_SIG_UNUSABLE = 100;
const SESSION_ECG_FS = 512;
const SESSION_PPG_FS = 100;
const STREAM_ECG_AND_PPG = 3;

interface Props {
  device: Device;
  onDisconnect: () => void;
  autoRecord?: boolean;
}

type DeviceTab = 'live' | 'wave' | 'stats' | 'debug';

/* ─── Display Value Merging ─── */

type DisplayValues = {
  hr: string; ecgHr: string; spo2: string;
  sbp: string; dbp: string; pi: string; pttMs: string;
  ecgSig: string; ir: string; ecgRaw: string; rrMs: string;
};

const EMPTY_DISPLAY: DisplayValues = {
  hr: '--', ecgHr: '--', spo2: '--',
  sbp: '--', dbp: '--', pi: '--', pttMs: '--',
  ecgSig: '--', ir: '--', ecgRaw: '--', rrMs: '--',
};

type Readout = {
  hr: HeldMedian;
  ecgHr: HeldMedian;
  spo2: HeldMedian;
  sbp: HeldMedian;
  dbp: HeldMedian;
  pi: HeldMedian;
  pttMs: HeldMedian;
  ir: HeldMedian;
  rrMs: HeldMedian;
};

function createReadout(): Readout {
  return {
    hr: new HeldMedian(),
    ecgHr: new HeldMedian(),
    spo2: new HeldMedian(),
    sbp: new HeldMedian(),
    dbp: new HeldMedian(),
    pi: new HeldMedian(),
    pttMs: new HeldMedian(),
    ir: new HeldMedian(),
    rrMs: new HeldMedian(),
  };
}

function fmtInt(v: number | null): string {
  return v == null ? '--' : String(Math.round(v));
}

function fmtFixed(v: number | null, digits: number): string {
  return v == null ? '--' : v.toFixed(digits);
}

/**
 * 血压、血氧、灌注进短时中位数。
 * 两个心率不在这里收：芯片会把一拍拆成两拍，或把两拍并成一拍，
 * 和画面上的波形不是一回事。心率由每秒一次的波形估计写入。
 */
function ingestPacket(r: Readout, pkt: BioPkt, now: number): void {
  if (pkt.spo2 > 0) r.spo2.push(pkt.spo2, now);
  if (pkt.flags.pttValid && pkt.sbp > 0) r.sbp.push(pkt.sbp, now);
  if (pkt.flags.pttValid && pkt.dbp > 0) r.dbp.push(pkt.dbp, now);
  if (pkt.pi > 0) r.pi.push(pkt.pi, now);
  if (pkt.flags.pttValid && pkt.pttMs > 0) r.pttMs.push(pkt.pttMs, now);
  if (pkt.ir > 0) r.ir.push(pkt.ir, now);
  if (pkt.rrMs > 0) r.rrMs.push(pkt.rrMs, now);
}

function snapshotDisplay(r: Readout, pkt: BioPkt | null, now: number): DisplayValues {
  return {
    hr: fmtInt(r.hr.read(now)),
    ecgHr: fmtInt(r.ecgHr.read(now)),
    spo2: fmtInt(r.spo2.read(now)),
    sbp: fmtInt(r.sbp.read(now)),
    dbp: fmtInt(r.dbp.read(now)),
    pi: fmtFixed(r.pi.read(now), 1),
    pttMs: fmtInt(r.pttMs.read(now)),
    ecgSig: pkt ? String(pkt.ecgSig) : '--',
    ir: fmtInt(r.ir.read(now)),
    ecgRaw: pkt ? String(pkt.ecgRaw) : '--',
    rrMs: fmtInt(r.rrMs.read(now)),
  };
}

/* ─── Local presentational helpers ─── */

/** One statistic block: metric name, then mean / min / max cells. */
function StatBlock({
  label,
  avg,
  min,
  max,
  unit,
  hue,
}: {
  label: string;
  avg: number | string;
  min: number | string;
  max: number | string;
  unit: string;
  hue: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statBlock}>
      <View style={styles.statBlockHeader}>
        <Text style={[type.h2, styles.statBlockLabel]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[type.caption, styles.statBlockUnit]} numberOfLines={1}>
          {unit}
        </Text>
      </View>
      <View style={styles.statCells}>
        <StatCell label="均值" value={String(avg || '--')} hue={hue} />
        <StatCell label="最小" value={String(min || '--')} />
        <StatCell label="最大" value={String(max || '--')} />
      </View>
    </View>
  );
}

/** Monospace log line that wraps instead of running off the screen. */
function LogLine({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={styles.debugLine} selectable>
      {text}
    </Text>
  );
}

export default function DeviceScreen({ device, onDisconnect, autoRecord = true }: Props) {
  const { color, vital } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [data, setData] = useState<BioPkt | null>(null);
  const [display, setDisplay] = useState<DisplayValues>(EMPTY_DISPLAY);
  const [paused, setPaused] = useState(false);
  /** V3：板载 LED 模式（LED_MODE_AUTO/ON/OFF/BLINK）*/
  const [ledMode, setLedMode] = useState<number>(LED_MODE_AUTO);
  const [pktCount, setPktCount] = useState(0);
  const [activeTab, setActiveTab] = useState<DeviceTab>('live');
  const [recording, setRecording] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [ecgWave, setEcgWave] = useState<number[]>([]);
  const [ppgWave, setPpgWave] = useState<number[]>([]);
  const [hrWave, setHrWave] = useState<number[]>([]);
  const [spo2Wave, setSpo2Wave] = useState<number[]>([]);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(
    bioBleMgr.discoveryInfo,
  );
  const [debugLines, setDebugLines] = useState<string[]>([...bioBleMgr.debugLog]);
  const [connType, setConnType] = useState<ConnectionType>(
    bioBleMgr.getConnectionType(),
  );
  /** Measured width of the waveform column; 0 until the first layout pass. */
  const [waveWidth, setWaveWidth] = useState(0);

  const cleanupRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const analyzerRef = useRef(new LiveAnalyzer());
  const readoutRef = useRef(createReadout());
  const sessionIdRef = useRef<number | null>(null);
  /** 协议 v4 波形重组器：会话期间持续按 index 落位并核算丢样 */
  const assemblerRef = useRef(new WaveformAssembler());
  /** 由最近一段心电波形重算的心率；芯片心率不可用时拿它和血氧对照 */
  const waveformHrRef = useRef<number | null>(null);
  const lastPktRef = useRef<BioPkt | null>(null);
  /** 波形流是否已成功开启（用于状态展示与自愈判断） */
  const streamOnRef = useRef(false);
  const wfRetryRef = useRef(0);
  /**
   * 波形流状态的 ref 镜像。
   *
   * ⚠ 为什么必须有它：上面的 effect 依赖数组里如果放 `streamState.state`，
   * 那么每次状态变化都会让 effect 重跑，而 effect 里有 `startRecording()` ——
   * 结果是**反复新建会话并 reset 重组器**，波形直接丢光。
   * 定时器里要读的只是"当前是否已判定失败"，用 ref 读就不必进依赖数组。
   */
  const streamStateRef = useRef<'off' | 'on' | 'error'>('off');
  /** 最近一次统计帧摘要（用于在界面上显示板载丢样） */
  const [wfStats, setWfStats] = useState<{
    ecgHz: number; ppgHz: number; ecgLoss: number; ppgLoss: number;
    fifoOvf: number; ntfErr: number; ecgPoints: number;
  } | null>(null);
  /** 波形流状态：off=未开 / on=已开 / error=开启失败（附原因） */
  const [streamState, setStreamState] = useState<{ state: 'off' | 'on' | 'error'; msg?: string }>({
    state: 'off',
  });

  /**
   * 开启波形流。
   *
   * 为什么每条命令单独 try 并重试：
   *   实测踩到过（会话 27，2026-09-29）：三条命令写在同一个 try 里时，
   *   只要**第一条**因 BLE 尚未完成服务发现而抛异常，后面两条就都不执行，
   *   结果是"点采样正常录制、波形一个点都没有"，而用户完全无感知
   *   （错误只进了 console.warn）。所以这里：逐条执行、失败重试、
   *   状态上屏；`CMD_STREAM` 是决定性的那条，单独标记成败。
   */
  const sendStreamCommands = useCallback(async (): Promise<boolean> => {
    const attempt = async (label: string, fn: () => Promise<void>): Promise<boolean> => {
      for (let i = 0; i < 3; i++) {
        try {
          await fn();
          return true;
        } catch (err: any) {
          if (i === 2) {
            console.warn(`[WF] ${label} 失败（尝试 3 次）:`, err?.message ?? err);
            return false;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      return false;
    };

    await attempt('CMD_SET_RATE', () => bioBleMgr.setRate(SESSION_RATE_CODE));
    await attempt('CMD_STATS', () => bioBleMgr.setStats(1));
    const ok = await attempt('CMD_STREAM', () => bioBleMgr.setStream(true, true));
    streamOnRef.current = ok;
    streamStateRef.current = ok ? 'on' : 'error';
    setStreamState(ok ? { state: 'on' } : { state: 'error', msg: '波形流开启失败（已重试 3 次）' });
    return ok;
  }, []);

  const startRecording = useCallback(async () => {
    if (!isReady()) return;
    // ★ 防重入：effect 在 device/props 变化时会重跑并调用本函数，
    //   若不拦住就会新建第二个会话、把正在录的那次的 sessionIdRef 冲掉，
    //   结果前一次的波形再也取不回来（stash 时用的是新 id）。
    if (sessionIdRef.current !== null) {
      console.log('[WF] 已在录制中，忽略重复的开始请求');
      return;
    }
    try {
      const name = device.localName || device.name || 'Unknown';
      const type = bioBleMgr.getConnectionType();
      const id = await createSession(name, device.id, type);
      sessionIdRef.current = id;
      setSessionId(id);
      setRecording(true);
      wfRetryRef.current = 0;
      assemblerRef.current.reset();
      // 不阻塞录制：波形流即使开启失败，点采样照常入库
      void sendStreamCommands();
    } catch (err) {
      console.warn('Failed to start recording:', err);
    }
  }, [device, sendStreamCommands]);

  const stopRecording = useCallback(async () => {
    if (sessionIdRef.current) {
      const id = sessionIdRef.current;
      // 先关流再收尾：避免结束瞬间的帧把质量数字搅乱
      try {
        if (streamOnRef.current) {
          await bioBleMgr.setStream(false, false);
        }
      } catch {
        /* 断连时关流失败无所谓 */
      }
      streamOnRef.current = false;
      // 把本次会话的波形与质量元数据暂存，供上传时一并提交
      try {
        const frames = assemblerRef.current.waveformFrames();
        const waveforms = buildUploadPayloads(assemblerRef.current);
        if (waveforms.length > 0) {
          stashSessionWaveforms(id, waveforms, buildQualityUpload(assemblerRef.current.summary()));
          console.log(`[WF] 会话 ${id} 暂存波形: 帧=${frames} 段=${waveforms.length}`);
        } else {
          // 这条日志是排查"某次录制没有波形"的关键线索，别删
          console.warn(`[WF] 会话 ${id} 没有任何波形样本（波形帧数=${frames}，流状态=${streamState.state}）`);
        }
      } catch (err) {
        console.warn('Failed to pack waveforms:', err);
      }
      await flushPending();
      await endSession(id);
      sessionIdRef.current = null;
      setSessionId(null);
      setRecording(false);
      setStreamState({ state: 'off' });
      streamStateRef.current = 'off';
    }
  }, []);

  useEffect(() => {
    setDiscovery(bioBleMgr.discoveryInfo);
    setConnType(bioBleMgr.getConnectionType());
    setDebugLines([...bioBleMgr.debugLog]);
    analyzerRef.current.reset();
    readoutRef.current = createReadout();

    if (autoRecord) {
      startRecording();
    }

    cleanupRef.current = bioBleMgr.subscribeToNotifications(
      (pkt) => {
        lastPktRef.current = pkt;
        setData(pkt);
        ingestPacket(readoutRef.current, pkt, Date.now());
        setPktCount((c) => c + 1);

        analyzerRef.current.addPacket(pkt);
        assemblerRef.current.bioPktCount++;

        if (sessionIdRef.current) {
          queueMeasurement(sessionIdRef.current, pkt);
        }
      },
      (err) => {
        setDebugLines([...bioBleMgr.debugLog]);
        Alert.alert('通知错误', err.message);
      },
      // ── 协议 v4：波形帧与统计帧走这里，不认识的帧由 ble 层计数丢弃 ──
      {
        onWaveform: (fr) => {
          assemblerRef.current.onWaveform(fr);
        },
        onStats: (st) => {
          assemblerRef.current.onStats(st);
          const s = assemblerRef.current.summary();
          setWfStats({
            ecgHz: st.ecgRateHz,
            ppgHz: st.ppgRateHz,
            ecgLoss: s.ecg.lostPoints,
            ppgLoss: s.ppg.lostPoints,
            fifoOvf: st.fifoOvf,
            ntfErr: st.ntfErr,
            ecgPoints: s.ecg.receivedPoints,
          });
        },
      },
    );

    setDebugLines([...bioBleMgr.debugLog]);
    bioBleMgr.startHeartbeatLoop();

    disconnectRef.current = bioBleMgr.onDisconnect(() => {
      stopRecording();
      Alert.alert('连接断开', '设备已断开连接');
      onDisconnect();
    });

    const updateTimer = setInterval(() => {
      setDebugLines([...bioBleMgr.debugLog]);
      setLiveStats(analyzerRef.current.getStats());
      const now = Date.now();
      const ecgTrack = assemblerRef.current.tracks.ecg;
      const ppgTrack = assemblerRef.current.tracks.ppg;
      const ecgFs = SESSION_ECG_FS;
      const ppgFs = SESSION_PPG_FS;
      const ecgEst = estimateHrBpm(ecgTrack.samples, ecgFs, 'ecg');
      const ppgEst = estimateHrBpm(ppgTrack.ir, ppgFs, 'ppg');
      waveformHrRef.current = ecgEst;
      const readout = readoutRef.current;
      const last = lastPktRef.current;
      // 大数字跟屏幕上这 8 秒波形走。芯片只在波形还数不出心拍时兜底，
      // 而且不因为脉搏心率对不上就把心电心率丢掉。
      if (ecgEst) {
        readout.ecgHr.push(ecgEst, now);
        analyzerRef.current.noteDisplayedHr('ecg', ecgEst);
      } else if (
        !readout.ecgHr.hasRecent(now) &&
        last &&
        last.ecgSig < ECG_SIG_UNUSABLE &&
        last.ecgHr > 0
      ) {
        readout.ecgHr.push(last.ecgHr, now);
      }
      if (ppgEst) {
        readout.hr.push(ppgEst, now);
        analyzerRef.current.noteDisplayedHr('ppg', ppgEst);
      } else if (!readout.hr.hasRecent(now) && last && last.hr > 0) {
        readout.hr.push(last.hr, now);
      }
      setDisplay(snapshotDisplay(readout, last, now));
      setEcgWave(liveTrace(ecgTrack.samples, ecgFs, 'ecg'));
      setPpgWave(liveTrace(ppgTrack.ir, ppgFs, 'ppg'));
      setHrWave(analyzerRef.current.getHrTrend());
      setSpo2Wave(analyzerRef.current.getSpo2Trend());

      // ── 波形流自愈 ────────────────────────────────────────────────
      // 正在录制、但连续若干秒一个波形帧都没收到 → 认为开流命令丢了
      // （实测踩到过：BLE 未完成服务发现时写特征抛异常，静默失败），
      // 自动重新下发命令，最多 5 次；仍不行就在界面上明说。
      if (sessionIdRef.current && assemblerRef.current.waveformFrames() === 0) {
        if (wfRetryRef.current < 5) {
          wfRetryRef.current++;
          console.log(`[WF] 录制中但无波形帧，重试开流 #${wfRetryRef.current}`);
          void sendStreamCommands();
        } else if (streamStateRef.current !== 'error') {
          streamStateRef.current = 'error';
          setStreamState({ state: 'error', msg: '波形流始终没有数据（点采样仍在录制）' });
        }
      }
    }, 1000);

    return () => {
      cleanupRef.current?.();
      disconnectRef.current?.();
      bioBleMgr.stopHeartbeatLoop();
      clearInterval(updateTimer);
      stopRecording();
    };
  }, [onDisconnect, autoRecord, startRecording, stopRecording, sendStreamCommands]);

  const handleToggle = async () => {
    try {
      await bioBleMgr.sendToggle();
      setPaused((p) => !p);
    } catch (err: any) {
      Alert.alert('发送失败', err.message);
    }
  };

  const handleDisconnect = async () => {
    await stopRecording();
    await bioBleMgr.disconnect();
    onDisconnect();
  };

  /* V3：板载 LED 模式控制（自动 → 常亮 → 常灭 → 快闪 循环切换）*/
  const handleCycleLed = async () => {
    const order = [LED_MODE_AUTO, LED_MODE_ON, LED_MODE_OFF, LED_MODE_BLINK];
    const idx = order.indexOf(ledMode);
    const next = order[(idx + 1) % order.length];
    try {
      await bioBleMgr.sendSetLed(next);
      setLedMode(next);
    } catch (err: any) {
      Alert.alert('发送失败', err.message);
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const onWaveLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== waveWidth) setWaveWidth(w);
  };

  const largeText = useLargeText();
  const insets = useSafeAreaInsets();
  const deviceName = device.localName || device.name || '未知设备';
  const connTypeLabel = connType === 'SLE' ? 'SLE' : connType === 'BLE' ? 'BLE' : 'AUTO';

  /* ─── Tab Content Renderers ─── */

  const renderLiveTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <View style={styles.badgeRow}>
        <StatusBadge ok={!!data?.flags.maxOk} label="PPG 传感器" />
        <StatusBadge ok={!!data?.flags.bmdOk} label="ECG 传感器" />
        <StatusBadge ok={!!data?.flags.finger} label="手指检测" />
        <StatusBadge ok={!!data?.flags.pttValid} label="PTT 有效" />
      </View>

      {/* V3：设备侧链路与指示灯状态（来自 bio_pkt_t.status 第 21 字节）
          旧固件（20 字节包）无此字段 → devStatus 为 undefined，自动隐藏 */}
      {data?.devStatus ? (
        <View style={styles.badgeRow}>
          <StatusBadge ok={data.devStatus.sleConn} label="星闪 SLE" />
          <StatusBadge ok={data.devStatus.bleConn} label="蓝牙 BLE" />
          <StatusBadge ok={data.devStatus.ledOn} label="板载 LED" />
          <StatusBadge ok={!data.devStatus.ledManual} label="LED 自动" />
        </View>
      ) : null}

      <MetricGrid>
        <MetricGridItem>
          <MetricTile
            label="心率 (PPG)"
            value={display.hr}
            unit="BPM"
            hue={vital.hr}
            emphasis
            trend={liveStats?.hrTrend}
          />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="心率 (ECG)" value={display.ecgHr} unit="BPM" hue={vital.ecgHr} emphasis />
        </MetricGridItem>
      </MetricGrid>

      <View style={styles.gridGap} />

      <MetricGrid>
        <MetricGridItem>
          <MetricTile label="血氧饱和度" value={display.spo2} unit="%" hue={vital.spo2} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="收缩压" value={display.sbp} unit="mmHg" hue={vital.sbp} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="舒张压" value={display.dbp} unit="mmHg" hue={vital.dbp} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="灌注指数" value={display.pi} unit="%" hue={vital.pi} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="脉搏传导时间" value={display.pttMs} unit="ms" hue={vital.ptt} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="ECG 信号质量" value={display.ecgSig} hue={vital.ecgSignal} />
        </MetricGridItem>
        <MetricGridItem>
          <MetricTile label="IR 原始值" value={display.ir} hue={vital.ir} />
        </MetricGridItem>
      </MetricGrid>

      <SectionTitle>原始数据</SectionTitle>
      <Card padded={false}>
        <DetailRow label="ECG 原始采样" value={display.ecgRaw} />
        <DetailRow label="R-R 间期" value={`${display.rrMs} ms`} />
        <DetailRow label="已接收数据包" value={String(pktCount)} last />
      </Card>

      <SectionTitle>设备控制</SectionTitle>
      <View style={styles.controlGrid}>
        <Button
          label={paused ? '恢复采集' : '暂停采集'}
          icon={paused ? 'play' : 'pause'}
          variant={paused ? 'primary' : 'secondary'}
          onPress={handleToggle}
          style={styles.controlBtn}
        />
        <Button
          label={`指示灯：${LED_MODE_LABELS[ledMode] ?? '自动'}`}
          icon="bulb"
          variant={ledMode === LED_MODE_AUTO ? 'secondary' : 'primary'}
          onPress={handleCycleLed}
          style={styles.controlBtn}
        />
      </View>
    </ScrollView>
  );

  const renderWaveTab = () => {
    const streamLabel =
      streamState.state === 'on'
        ? '已开启'
        : streamState.state === 'error'
        ? `失败（${streamState.msg ?? ''}）`
        : recording
        ? '正在开启…'
        : '未开启';

    return (
      <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
        {/* Width comes from the container, never from a captured window size. */}
        <View style={styles.waveSlot} onLayout={onWaveLayout}>
          {waveWidth > 0 ? (
            <Waveform
              data={ecgWave}
              width={waveWidth}
              height={150}
              color={color.success}
              label={`ECG 波形（${wfStats?.ecgHz || 512} Hz · ${LIVE_TRACE_SECONDS} 秒）`}
              unit="raw"
              signed
            />
          ) : null}
        </View>
        <View style={styles.waveGap} />
        <View style={styles.waveSlot}>
          {waveWidth > 0 ? (
            <Waveform
              data={ppgWave}
              width={waveWidth}
              height={120}
              color={vital.hr}
              label={`PPG 波形（${wfStats?.ppgHz || 100} Hz · ${LIVE_TRACE_SECONDS} 秒）`}
              unit="IR"
              signed
            />
          ) : null}
        </View>

        <Card style={styles.waveInfo}>
          <DetailRow
            label="显示窗口"
            value={`最近 ${LIVE_TRACE_SECONDS} 秒`}
          />
          <DetailRow label="累计 ECG 点" value={String(wfStats?.ecgPoints ?? 0)} />
          <DetailRow
            label="采样速率"
            value={`ECG ${wfStats?.ecgHz ?? 0} Hz · PPG ${wfStats?.ppgHz ?? 0} Hz`}
          />
          <DetailRow
            label="丢样"
            value={`ECG ${wfStats?.ecgLoss ?? 0} · PPG ${wfStats?.ppgLoss ?? 0}`}
          />
          <DetailRow
            label="板载 FIFO 溢出"
            value={String(wfStats?.fifoOvf ?? 0)}
            valueColor={(wfStats?.fifoOvf ?? 0) > 0 ? color.warningText : undefined}
          />
          <DetailRow
            label="通知写入失败"
            value={String(wfStats?.ntfErr ?? 0)}
            valueColor={(wfStats?.ntfErr ?? 0) > 0 ? color.dangerText : undefined}
          />
          <DetailRow
            label="波形流"
            value={streamLabel}
            valueColor={streamState.state === 'on' ? color.successText : undefined}
            last
          />
        </Card>

        {!recording ? (
          <View style={styles.hint}>
            <Icon name="info" size={15} color={color.textMuted} />
            <Text style={[type.caption, styles.hintText]}>
              当前未在录制。点击顶部「记录」可开启波形流并开始采集。
            </Text>
          </View>
        ) : null}

        <SectionTitle>趋势</SectionTitle>
        <View style={styles.waveSlot}>
          {waveWidth > 0 ? (
            <Waveform
              data={hrWave}
              width={waveWidth}
              height={104}
              color={vital.hr}
              label="心率趋势"
              unit="BPM"
            />
          ) : null}
        </View>
        <View style={styles.waveGap} />
        <View style={styles.waveSlot}>
          {waveWidth > 0 ? (
            <Waveform
              data={spo2Wave}
              width={waveWidth}
              height={104}
              color={vital.spo2}
              label="血氧趋势"
              unit="%"
            />
          ) : null}
        </View>
      </ScrollView>
    );
  };

  const renderStatsTab = () => {
    const s = liveStats;
    return (
      <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
        <SectionTitle first>本次会话</SectionTitle>
        <Card padded={false}>
          <DetailRow label="采集时长" value={formatDuration(s?.duration ?? 0)} />
          <DetailRow label="有效样本" value={`${s?.sampleCount ?? 0} 个`} />
          <DetailRow label="连接方式" value={connTypeLabel} />
          <DetailRow
            label="记录状态"
            value={recording ? '正在记录' : '未记录'}
            valueColor={recording ? color.successText : color.textMuted}
            last
          />
        </Card>

        <SectionTitle>实时统计</SectionTitle>
        <View style={styles.statStack}>
          <StatBlock
            label="心率 (PPG)"
            avg={s?.hrAvg ?? 0}
            min={s?.hrMin ?? 0}
            max={s?.hrMax ?? 0}
            unit="BPM"
            hue={vital.hr}
          />
          <StatBlock
            label="心率 (ECG)"
            avg={s?.ecgHrAvg ?? 0}
            min={s?.ecgHrMin ?? 0}
            max={s?.ecgHrMax ?? 0}
            unit="BPM"
            hue={vital.ecgHr}
          />
          <StatBlock
            label="血氧"
            avg={s?.spo2Avg ?? 0}
            min={s?.spo2Min ?? 0}
            max={s?.spo2Max ?? 0}
            unit="%"
            hue={vital.spo2}
          />
          <StatBlock
            label="血压"
            avg={s?.sbpAvg ?? 0}
            min={s?.dbpAvg ?? 0}
            max={0}
            unit="mmHg"
            hue={vital.sbp}
          />
          <StatBlock
            label="灌注指数"
            avg={s?.piAvg ?? 0}
            min={0}
            max={0}
            unit="%"
            hue={vital.pi}
          />
        </View>
        <Text style={[type.caption, styles.statNote]}>
          均值 / 最小 / 最大基于本次连接期间收到的全部有效数据包实时计算。
        </Text>
      </ScrollView>
    );
  };

  const renderDebugTab = () => (
    <ScrollView style={styles.tabBody} contentContainerStyle={styles.tabContent}>
      <SectionTitle first>连接状态</SectionTitle>
      <Card padded={false}>
        {discovery ? (
          <>
            <DetailRow label="服务 UUID" value={discovery.serviceUUID} stack mono />
            <DetailRow label="特征 UUID" value={discovery.charUUID} stack mono />
            <DetailRow label="发现方式" value={discovery.method} />
            <DetailRow
              label="连接类型"
              value={
                discovery.connectionType === 'SLE'
                  ? 'SLE (NearLink)'
                  : discovery.connectionType === 'BLE'
                  ? 'BLE (Bluetooth)'
                  : '自动发现'
              }
              last
            />
          </>
        ) : (
          <View style={styles.debugMissing}>
            <Icon name="alert" size={15} color={color.dangerText} />
            <Text style={[type.body, styles.debugMissingText]}>未选中任何特征值</Text>
          </View>
        )}
      </Card>

      <SectionTitle>发现的服务（{bioBleMgr.allServices.length}）</SectionTitle>
      {bioBleMgr.allServices.length === 0 ? (
        <Card>
          <Text style={[type.body, styles.debugEmptyText]}>无服务发现</Text>
        </Card>
      ) : (
        <View style={styles.debugStack}>
          {bioBleMgr.allServices.map((svc, si) => (
            <Card key={si}>
              <Text style={styles.debugSvcUuid} selectable>
                SVC {svc.uuid}
              </Text>
              {svc.chars.map((ch, ci) => (
                <Text key={ci} style={styles.debugCharLine} selectable>
                  CHR {ch.uuid} [{ch.props.join(',')}]
                </Text>
              ))}
            </Card>
          ))}
        </View>
      )}

      <SectionTitle>调试日志</SectionTitle>
      <Card style={styles.debugWell}>
        {debugLines.length === 0 ? (
          <Text style={[type.body, styles.debugEmptyText]}>暂无日志</Text>
        ) : (
          debugLines.map((line, i) => <LogLine key={i} text={line} />)
        )}
      </Card>
    </ScrollView>
  );

  return (
    <Screen>
      {/* ─── Header ─── */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + space.md },
          largeText && styles.headerStacked,
        ]}
      >
        <View style={styles.headerText}>
          <View style={styles.headerTitleRow}>
            {/* No maxWidth cap: the name shrinks as needed instead of being
                truncated at an arbitrary 140px on every device. */}
            <Text style={[type.h1, styles.title]} numberOfLines={1} ellipsizeMode="middle">
              {deviceName}
            </Text>
            <Pill label={connTypeLabel} tone={connType === 'SLE' ? 'violet' : 'accent'} />
            {recording ? (
              <Pill label="REC" tone="bad" icon="activity" />
            ) : null}
          </View>
          <Text style={[type.caption, styles.subtitle]} numberOfLines={1}>
            已连接 · {pktCount} 个数据包
            {liveStats ? ` · ${formatDuration(liveStats.duration)}` : ''}
          </Text>
        </View>

        <View style={[styles.headerActions, largeText && styles.headerActionsStacked]}>
          <Button
            label={recording ? '停止' : '记录'}
            size="sm"
            variant={recording ? 'danger' : 'secondary'}
            onPress={toggleRecording}
            style={largeText ? styles.headerActionBtn : undefined}
          />
          <Button
            label="断开"
            size="sm"
            variant="danger"
            onPress={handleDisconnect}
            style={largeText ? styles.headerActionBtn : undefined}
          />
        </View>
      </View>

      {/* ─── Tab Content ─── */}
      {activeTab === 'live' && renderLiveTab()}
      {activeTab === 'wave' && renderWaveTab()}
      {activeTab === 'stats' && renderStatsTab()}
      {activeTab === 'debug' && renderDebugTab()}

      {/* ─── Tab Bar ─── */}
      <TabBar
        tabs={[
          { id: 'live', label: '实时', icon: 'activity' },
          { id: 'wave', label: '趋势', icon: 'trend' },
          { id: 'stats', label: '分析', icon: 'barChart' },
          { id: 'debug', label: '调试', icon: 'terminal' },
        ]}
        activeTab={activeTab}
        onSelect={(id) => setActiveTab(id as DeviceTab)}
      />
    </Screen>
  );
}

/* ─── Styles ─── */

function makeStyles(color: Palette) {
  return StyleSheet.create({
  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: color.surface,
    borderBottomWidth: 1,
    borderBottomColor: color.divider,
  },
  headerStacked: { flexDirection: 'column', alignItems: 'stretch' },
  headerText: { flex: 1, minWidth: 0 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { color: color.text, flexShrink: 1, minWidth: 0 },
  subtitle: { color: color.textMuted, marginTop: space.xxs },
  headerActions: { flexDirection: 'row', gap: space.sm, flexShrink: 0 },
  headerActionsStacked: { marginTop: space.md },
  headerActionBtn: { flex: 1 },

  /* Tab body */
  tabBody: { flex: 1 },
  tabContent: { padding: space.md, paddingBottom: space.xxxl },

  /* Live tab */
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  gridGap: { height: space.sm },
  statStack: { gap: space.sm },
  statNote: { color: color.textMuted, marginTop: space.md, lineHeight: 22 },

  statBlock: {
    backgroundColor: color.raised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.md,
    gap: space.md,
  },
  statBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  statBlockLabel: { color: color.textSecondary, flexShrink: 1, minWidth: 0 },
  statBlockUnit: { color: color.textMuted, flexShrink: 0 },
  statCells: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },

  controlGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  controlBtn: { flexGrow: 1, flexBasis: '46%', minWidth: 150 },

  /* Wave tab */
  waveSlot: { width: '100%' },
  waveGap: { height: space.md },
  waveInfo: { marginTop: space.md },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.xs,
  },
  hintText: { color: color.textMuted, flex: 1, lineHeight: 22 },

  /* Debug tab */
  debugStack: { gap: space.sm },
  debugWell: { backgroundColor: color.sunken, ...sunkenChrome(color) },
  debugEmptyText: { color: color.textMuted },
  debugMissing: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg },
  debugMissingText: { color: color.dangerText },
  debugLine: {
    fontSize: 13,
    lineHeight: 19,
    color: color.textSecondary,
    fontFamily: monoFont,
    marginBottom: space.xxs,
  },
  debugSvcUuid: {
    fontSize: 14,
    lineHeight: 20,
    color: color.accentText,
    fontFamily: monoFont,
    fontWeight: '700',
    marginBottom: space.xs,
  },
  debugCharLine: {
    fontSize: 13,
    lineHeight: 19,
    color: color.textMuted,
    fontFamily: monoFont,
  },
});
}
