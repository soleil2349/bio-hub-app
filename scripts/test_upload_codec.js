#!/usr/bin/env node
/**
 * 上传序列化往返测试（App 侧 → 服务端解码约定）。
 *
 * 验证什么：
 *   1. App 压出来的 base64(zlib(样本)) 能被**服务端同一套约定**解开且逐字节无损；
 *   2. ECG 用 int16 小端、PPG 用 u32 小端 (ir,red) 成对，与
 *      bio_hub_server/app/waveform.py 的 decode_payload 完全对齐；
 *   3. buildUploadPayloads() 的 count/index0 与 assembler 记录一致
 *      （服务器按这两个值独立核算缺口，错了就会误报丢样）。
 *
 * 为什么必须测：这一步跨了两个运行时（RN 里用 pako 压缩、服务器用 Python zlib），
 * 一旦压缩格式或字节序不一致，服务端会 422 或（更糟）解出错位的数据。
 *
 * 用法：npm run test:upload
 */
'use strict';

const assert = require('assert');
const zlib = require('zlib');
const { WaveformAssembler, buildUploadPayloads, buildQualityUpload, toBase64 } = require('../.proto-test/waveform.js');

let pass = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name + (extra ? '  ' + extra : ''));
  } else {
    fails.push(name);
    console.log('  FAIL ' + name + (extra ? '  ' + extra : ''));
  }
}

/** 服务端解码约定（照 bio_hub_server/app/waveform.py 的 decode_payload 实现） */
function serverDecode(dataB64, fmt, count) {
  const comp = Buffer.from(dataB64, 'base64');
  const blob = zlib.inflateSync(comp);
  if (fmt === 1) {
    assert.strictEqual(blob.length, count * 2, 'ecg blob 长度不符');
    const out = new Int16Array(count);
    for (let i = 0; i < count; i++) out[i] = blob.readInt16LE(i * 2);
    return out;
  }
  assert.strictEqual(blob.length, count * 8, 'ppg blob 长度不符');
  const ir = new Uint32Array(count);
  const red = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    ir[i] = blob.readUInt32LE(i * 8);
    red[i] = blob.readUInt32LE(i * 8 + 4);
  }
  return { ir, red };
}

// ── 造帧（与固件组帧逐字节一致：0xE1, (fmt<<4)|signal, n, index u32LE, payload）
function ecgFrame(index, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(7 + n * 2);
  buf[0] = 0xE1;
  buf[1] = (1 << 4) | 1;         // fmt=I16, signal=ECG
  buf[2] = n;
  buf.writeUInt32LE(index >>> 0, 3);
  for (let i = 0; i < n; i++) buf.writeInt16LE(samples[i], 7 + i * 2);
  return new Uint8Array(buf);
}

function ppgFrame(index, pairs) {
  const n = pairs.length;
  const buf = Buffer.alloc(7 + n * 8);
  buf[0] = 0xE1;
  buf[1] = (5 << 4) | 2;         // fmt=U32X2, signal=PPG
  buf[2] = n;
  buf.writeUInt32LE(index >>> 0, 3);
  for (let i = 0; i < n; i++) {
    buf.writeUInt32LE(pairs[i][0] >>> 0, 7 + i * 8);
    buf.writeUInt32LE(pairs[i][1] >>> 0, 7 + i * 8 + 4);
  }
  return new Uint8Array(buf);
}

console.log('=== V1 base64 编码（纯 JS，无 Buffer）===');
{
  const samples = [0, 1, -1, 32767, -32768, 12345, -9999];
  for (const len of [0, 1, 2, 3, 4, 5, 7, 16]) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
    const mine = toBase64(bytes);
    const node = Buffer.from(bytes).toString('base64');
    check('toBase64 与 Buffer 一致 (len=' + len + ')', mine === node,
      mine === node ? '' : `mine=${mine} node=${node}`);
  }
  void samples;
}

console.log('\n=== V2 ECG 往返（App 编码 → 服务端约定解码）===');
{
  const asm = new WaveformAssembler();
  const total = 1200;
  const samples = [];
  for (let i = 0; i < total; i++) samples.push(Math.round(2000 * Math.sin(i / 7) + (i % 13) - 6));
  // 分成若干帧喂入，并让 index 连续
  asm.onStats({ ecgRateHz: 512, ppgRateHz: 100, uartRxDrop: 0, ecgStreamDrop: 0,
                ppgStreamDrop: 0, fifoOvf: 0, ntfErr: 0, chkFail: 0, streamState: 0 });
  let idx = 0;
  while (idx < total) {
    const take = Math.min(120, total - idx);
    asm.onWaveform(parseEcgFrame(ecgFrame(idx, samples.slice(idx, idx + take))));
    idx += take;
  }
  const payloads = buildUploadPayloads(asm);
  check('生成 1 段 ECG', payloads.length === 1 && payloads[0].signal === 1);
  const p = payloads[0];
  check('count = 实收点数', p.count === total, `count=${p.count}`);
  check('index0 = 0', p.index0 === 0);
  check('fsHz 取自统计帧', p.fsHz === 512);

  const decoded = serverDecode(p.dataB64, p.fmt, p.count);
  let same = decoded.length === total;
  for (let i = 0; same && i < total; i++) same = decoded[i] === samples[i];
  check('服务端解码逐点一致', same);
  const ratio = Buffer.from(p.dataB64, 'base64').length / (total * 2);
  check('压缩确实有效', ratio < 1, `compressed/original=${(ratio * 100).toFixed(1)}%`);
}

console.log('\n=== V3 PPG 往返（u32 对）===');
{
  const asm = new WaveformAssembler();
  asm.onStats({ ecgRateHz: 512, ppgRateHz: 100, uartRxDrop: 0, ecgStreamDrop: 0,
                ppgStreamDrop: 0, fifoOvf: 0, ntfErr: 0, chkFail: 0, streamState: 0 });
  const pairs = [];
  for (let i = 0; i < 400; i++) pairs.push([67000 + (i % 97), 43000 + (i % 51)]);
  let idx = 0;
  while (idx < pairs.length) {
    const take = Math.min(24, pairs.length - idx);
    asm.onWaveform(parsePpgFrame(ppgFrame(idx, pairs.slice(idx, idx + take))));
    idx += take;
  }
  const p = buildUploadPayloads(asm).find((x) => x.signal === 2);
  check('生成 PPG 段', !!p);
  check('PPG count = 对数', p.count === pairs.length, `count=${p.count}`);
  const d = serverDecode(p.dataB64, p.fmt, p.count);
  let okIr = true, okRed = true;
  for (let i = 0; i < pairs.length; i++) {
    if (d.ir[i] !== pairs[i][0]) okIr = false;
    if (d.red[i] !== pairs[i][1]) okRed = false;
  }
  check('ir 通道一致', okIr);
  check('red 通道一致（与 ir 同刻）', okRed);
}

console.log('\n=== V4 丢样核算与上传质量字段一致 ===');
{
  const asm = new WaveformAssembler();
  asm.onStats({ ecgRateHz: 512, ppgRateHz: 100, uartRxDrop: 0, ecgStreamDrop: 0,
                ppgStreamDrop: 0, fifoOvf: 7, ntfErr: 0, chkFail: 0, streamState: 0 });
  asm.onWaveform(parseEcgFrame(ecgFrame(0, [1, 2, 3, 4])));
  asm.onWaveform(parseEcgFrame(ecgFrame(14, [5, 6, 7, 8])));   // 缺口 10 点
  const q = buildQualityUpload(asm.summary());
  check('缺口被记为 lostPoints=10', q.ecgLostPoints === 10, `lost=${q.ecgLostPoints}`);
  check('expectedPoints 按 index 跨度', q.ecgExpectedPoints === 18, `expected=${q.ecgExpectedPoints}`);
  check('receivedPoints=8', q.ecgReceivedPoints === 8);
  check('板载 fifoOvf 透传', q.onboardFifoOvf === 7);
  check('字段名与服务器 SessionQualityIn 一致',
    ['ecgNominalHz','ecgReceivedPoints','ecgExpectedPoints','ecgLostPoints',
     'unknownFrames','malformedFrames','onboardFifoOvf'].every((k) => k in q));

  // 关键：由于固件 index 不跳过 ring 溢出量，expectedPoints 可能明显大于实收；
  // 服务器会把这差值当作丢样。App 侧也要把同样的量报出去，双方口径一致。
  const agg = asm.summary().ecg.aggregateIndexGap;
  check('aggregateIndexGap = index跨度 − 实收', agg === 10, `agg=${agg}`);
}

console.log('\n=== V5 空会话不应产生载荷 ===');
{
  const asm = new WaveformAssembler();
  check('无波形时 uploadPayloads 为空', buildUploadPayloads(asm).length === 0);
  const q = buildQualityUpload(asm.summary());
  check('无板载统计时 onboard 全 0', q.onboardFifoOvf === 0 && q.onboardNtfErr === 0);
}

function parseEcgFrame(bytes) {
  const n = bytes[2];
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(new DataView(bytes.buffer, bytes.byteOffset).getInt16(7 + i * 2, true));
  return { signal: 1, fmt: 1, count: n, index: new DataView(bytes.buffer, bytes.byteOffset).getUint32(3, true),
           samples, ir: [], red: [] };
}

function parsePpgFrame(bytes) {
  const n = bytes[2];
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const ir = [], red = [];
  for (let i = 0; i < n; i++) { ir.push(dv.getUint32(7 + i * 8, true)); red.push(dv.getUint32(7 + i * 8 + 4, true)); }
  return { signal: 2, fmt: 5, count: n, index: dv.getUint32(3, true), samples: [], ir, red };
}

console.log('\n' + '='.repeat(58));
if (fails.length) {
  console.log(`FAILED: ${fails.length} 项 -> ${fails.join(', ')}`);
  process.exit(1);
}
console.log(`ALL PASS: ${pass} checks`);
