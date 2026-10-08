/**
 * 协议 v4 一致性测试（App 侧，Node 运行，无需设备）。
 *
 * 运行（在 bio_hub_app/ 下）：
 *   npm run test:proto
 * 它等价于：
 *   tsc src/protocol.ts src/waveform.ts --outDir .proto-test --module commonjs \
 *       --target es2020 --strict --skipLibCheck --ignoreConfig
 *   node scripts/test_protocol_v4.js [vectors.json 路径]
 *
 * 测试向量由固件侧生成：
 *   python fbb_ws63_v2/tools/proto/test_protocol.py --vectors
 *
 * 为什么必须存在：固件（C）· App（TS）· 服务器（Python）三份实现只有对着
 * **同一份向量**才能证明解析一致；任何一侧偏离协议都会被这里测出来。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const COMPILED = path.join(__dirname, '..', '.proto-test');
if (!fs.existsSync(path.join(COMPILED, 'protocol.js'))) {
  console.error('未找到编译产物，请先运行: npm run test:proto');
  process.exit(2);
}

const P = require(path.join(COMPILED, 'protocol.js'));
const W = require(path.join(COMPILED, 'waveform.js'));

let checks = 0;
const failures = [];

function check(cond, label, detail = '') {
  checks++;
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label} ${detail}`.trim());
    console.log(`  FAIL ${label} ${detail}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}
const fromHex = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));

function main() {
  const vectorsPath =
    process.argv[2] ||
    path.join(__dirname, '..', '..', 'fbb_ws63_v2', 'tools', 'proto', 'vectors.json');
  if (!fs.existsSync(vectorsPath)) {
    console.error(`vectors not found: ${vectorsPath}`);
    console.error('请先运行: python fbb_ws63_v2/tools/proto/test_protocol.py --vectors');
    return 2;
  }
  const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8'));
  console.log(`vectors : ${vectorsPath}`);
  console.log(`protocol: ${vectors.protocol}`);

  // ── V1 帧类型判定 ──────────────────────────────────────────────────
  section('V1 帧类型判定（与固件/服务器同规则）');
  const frames = vectors.frames;
  for (const [name, v] of Object.entries(frames)) {
    const kind = P.classifyFrame(fromHex(v.hex));
    check(kind === v.expect.kind, `${name}: classifyFrame = ${v.expect.kind}`, `got ${kind}`);
  }
  for (const [name, hex] of Object.entries(vectors.rejects)) {
    const buf = fromHex(hex);
    const kind = P.classifyFrame(buf);
    // 最关键的性质（比具体归类更重要）：拒绝样例**绝不能**被当成生理数据。
    // 这正是 v3 的缺陷所在：50 字节波形帧被解析成 hr=0xEC=236 并可能入库。
    check(kind !== 'bio_pkt', `${name}: 不会被当成 bio_pkt`);
    if (kind === 'waveform') {
      // 按魔数归类为波形帧，但结构校验必须拒绝（长度/n 不符 → null）
      check(P.parseWaveformFrame(buf) === null, `${name}: 波形帧结构校验拒绝`);
    } else if (kind === 'stats') {
      check(P.parseStatsFrame(buf) === null, `${name}: 统计帧结构校验拒绝`);
    } else {
      check(kind === 'unknown', `${name}: 判为 unknown 并计数`);
    }
  }

  // ── V2 bio_pkt ────────────────────────────────────────────────────
  section('V2 bio_pkt 解析与版本区分');
  const bp4 = frames['bio_pkt_v4'];
  const p4 = P.parseBioPkt(fromHex(bp4.hex));
  check(!!p4, 'v4 包可解析');
  if (p4) {
    const e = bp4.expect;
    check(
      p4.hr === e.hr &&
        p4.spo2 === e.spo2 &&
        p4.rrMs === e.rrMs &&
        p4.ecgSig === e.ecgSig &&
        p4.streamState === e.streamState &&
        p4.drop1s === e.drop1s &&
        p4.version === 4,
      'v4 字段逐项一致',
      JSON.stringify({ hr: p4.hr, spo2: p4.spo2, rrMs: p4.rrMs, ss: p4.streamState, drop: p4.drop1s })
    );
  }
  const p3 = P.parseBioPkt(fromHex(frames['bio_pkt_v3_compat'].hex));
  check(!!p3 && p3.version === 3, 'v3 兼容包识别为 version 3');
  check(!!p3 && p3.drop1s === undefined, 'v3 包不臆造 v4 专有字段');

  // ★ 关键回归：v3 的真实缺陷 —— 波形帧被当成生理数据
  const legacy = fromHex(vectors.rejects['legacy_0xEC_waveform']);
  check(legacy.length === 50 && legacy[0] === 0xec, '样例确实是 50 字节 0xEC 波形帧');
  check(P.parseBioPkt(legacy) === null, '旧 0xEC 波形帧不再被解析成生理数据（修掉 v3 缺陷）');

  // ── V3 波形帧 ─────────────────────────────────────────────────────
  section('V3 波形帧解析（ECG / PPG）');
  const ecgBuf = fromHex(frames['ecg'].hex);
  const ecgFr = P.parseWaveformFrame(ecgBuf);
  check(!!ecgFr, 'ECG 帧可解析');
  if (ecgFr) {
    check(
      ecgFr.signal === P.WF_SIG_ECG && ecgFr.fmt === P.WF_FMT_I16,
      'ECG signal/fmt 正确'
    );
    check(ecgFr.count === frames['ecg'].expect.count, 'ECG 点数一致');
    check(ecgFr.index === frames['ecg'].expect.index, 'ECG index 一致');
    check(
      frames['ecg'].expect.samples.every((v, i) => ecgFr.samples[i] === v),
      'ECG 样本逐点一致'
    );
    // 上传格式可复现：pack 出来的字节必须与固件负载逐字节相同
    const repacked = Buffer.from(W.packInt16LE(ecgFr.samples));
    const body = Buffer.from(ecgBuf.slice(7));
    check(repacked.equals(body), 'packInt16LE 与固件负载逐字节一致（上传可直接复用）');
  }

  const ppgBuf = fromHex(frames['ppg'].hex);
  const ppgFr = P.parseWaveformFrame(ppgBuf);
  check(!!ppgFr, 'PPG 帧可解析');
  if (ppgFr) {
    check(ppgFr.signal === P.WF_SIG_PPG && ppgFr.fmt === P.WF_FMT_U32X2, 'PPG signal/fmt 正确');
    check(frames['ppg'].expect.ir.every((v, i) => ppgFr.ir[i] === v), 'PPG ir 通道一致');
    check(
      frames['ppg'].expect.red.every((v, i) => ppgFr.red[i] === v),
      'PPG red 通道一致（与 ir 严格同刻）'
    );
    const repacked = Buffer.from(W.packU32PairsLE(ppgFr.ir, ppgFr.red));
    check(repacked.equals(Buffer.from(ppgBuf.slice(7))), 'packU32PairsLE 与固件负载一致');
  }

  // ── V4 统计帧 ─────────────────────────────────────────────────────
  section('V4 统计帧解析');
  const st = P.parseStatsFrame(fromHex(frames['stats'].hex));
  check(!!st, '统计帧可解析');
  if (st) {
    const e = frames['stats'].expect;
    check(
      st.uptimeS === e.uptimeS &&
        st.uartRxDrop === e.uartRxDrop &&
        st.ecgStreamDrop === e.ecgStreamDrop &&
        st.ppgStreamDrop === e.ppgStreamDrop &&
        st.fifoOvf === e.fifoOvf &&
        st.ntfErr === e.ntfErr &&
        st.ecgRateHz === e.ecgRateHz &&
        st.ppgRateHz === e.ppgRateHz &&
        st.streamState === e.streamState &&
        st.ecgDecim === e.ecgDecim &&
        st.chkFail === e.chkFail,
      '统计帧 11 个字段逐项一致'
    );
  }

  // ── V5 重组器 ─────────────────────────────────────────────────────
  section('V5 重组器：丢样核算与速率切换');
  const mkEcg = (index, n, val) => {
    const buf = new Uint8Array(7 + n * 2);
    const view = new DataView(buf.buffer);
    buf[0] = P.WF_MAGIC;
    buf[1] = (P.WF_FMT_I16 << 4) | P.WF_SIG_ECG;
    buf[2] = n;
    view.setUint32(3, index, true);
    for (let i = 0; i < n; i++) view.setInt16(7 + i * 2, val, true);
    return P.parseWaveformFrame(buf);
  };

  const asm = new W.WaveformAssembler();
  asm.onStats(P.parseStatsFrame(fromHex(frames['stats'].hex)));
  asm.onWaveform(mkEcg(0, 100, 1));     // index 0..99
  asm.onWaveform(mkEcg(130, 100, 2));   // 本应从 100 开始 → 丢 30 点
  const s = asm.summary();
  check(s.ecg.receivedPoints === 200, '收到 200 点', `${s.ecg.receivedPoints}`);
  check(s.ecg.expectedPoints === 230, '应有 230 点', `${s.ecg.expectedPoints}`);
  check(s.ecg.lostPoints === 30, '丢样 30 点被精确检出', `${s.ecg.lostPoints}`);
  check(s.ecg.lossPct > 13, '丢失比例如实上报', `${s.ecg.lossPct}%`);
  check(s.ecg.nominalHz === 512, '名义速率取自统计帧', `${s.ecg.nominalHz}`);
  check(s.ecg.effectiveHz < s.ecg.nominalHz, '有效速率低于名义值（不谎报）', `${s.ecg.effectiveHz}`);

  const asm2 = new W.WaveformAssembler();
  asm2.onWaveform(mkEcg(500, 10, 1));
  asm2.onWaveform(mkEcg(510, 10, 1));
  asm2.onWaveform(mkEcg(0, 10, 2)); // 固件改速率 → 流复位
  const s2 = asm2.summary();
  check(s2.ecg.rateResets === 1, '识别出速率切换');
  check(s2.ecg.lostPoints === 0, '速率切换不误算为丢样', `${s2.ecg.lostPoints}`);

  // ── V6 常量自检 ───────────────────────────────────────────────────
  section('V6 常量自检');
  check(P.HR_SANITY_MAX < P.WF_MAGIC, '心率上限 < 波形魔数（0xE1 不歧义）');
  check(P.WF_MAGIC === 0xe1 && P.ST_MAGIC === 0xe2, '魔数与固件一致');

  console.log(`\n${'='.repeat(60)}`);
  if (failures.length) {
    console.log(`FAILED: ${failures.length}/${checks} checks`);
    failures.forEach((f) => console.log(`  - ${f}`));
    return 1;
  }
  console.log(`ALL PASS: ${checks} checks`);
  return 0;
}

process.exit(main());
