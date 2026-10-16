import { it, expect } from "vitest";
import { MemoryIo, ioPutFloatLE, ioPutInt32LE, ioPutU16LE, ioPutUint32LE } from "../src/data.js";
import { Woice, WoiceType, VoiceType, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { PxtnErr } from "../src/error.js";
import { makePcmWoice, makePtvWoice } from "./helpers.js";

it("matePTV round trips", () => {
  const w = makePtvWoice();
  const io = new MemoryIo();
  expect(w.ioMatePtvW(io)).toBe(true);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.ioMatePtvR(io)).toBe(PxtnErr.OK);
  expect(w2.type).toBe(WoiceType.PTV);
  const vc = w2.getVoice(0)!;
  expect(vc.type).toBe(VoiceType.Coodinate);
  expect(vc.volume).toBe(34);
  expect(vc.pan).toBe(64);
  expect(vc.wave.num).toBe(5);
  expect(vc.wave.reso).toBe(64);
  expect(vc.wave.points).toEqual(w.getVoice(0)!.wave.points);
  expect(vc.envelope.fps).toBe(60);
  expect(vc.envelope.points).toEqual(w.getVoice(0)!.envelope.points);
});

it("PTV read() parses a raw PTVOICE- blob", () => {
  const w = makePtvWoice();
  const io = new MemoryIo();
  expect(w.ptvWrite(io)).toBeGreaterThan(0);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.read(io, WoiceType.PTV)).toBe(PxtnErr.OK);
  expect(w2.voiceNum).toBe(1);
  expect(w2.getVoice(0)!.volume).toBe(34);
});

it("matePCM round trips", () => {
  const w = makePcmWoice(true);
  const p = w.getVoice(0)!.pcm;
  const io = new MemoryIo();
  expect(w.ioMatePcmW(io)).toBe(true);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.ioMatePcmR(io)).toBe(PxtnErr.OK);
  expect(w2.type).toBe(WoiceType.PCM);
  const vc2 = w2.getVoice(0)!;
  expect(vc2.type).toBe(VoiceType.Sampling);
  expect(vc2.pcm.sps).toBe(44100);
  expect(vc2.pcm.smpBody).toBe(8);
  expect(vc2.pcm.pBuf).toEqual(p.pBuf);
  expect(vc2.voiceFlags).toBe(PTV_VOICEFLAG_WAVELOOP);
});

it("reads matePCM data whose size is not frame aligned", () => {
  const io = new MemoryIo();
  ioPutInt32LE(io, 24 + 5); // size
  ioPutU16LE(io, 0); // x3x_unit_no
  ioPutU16LE(io, 60); // basic_key
  ioPutUint32LE(io, 0); // voice_flags
  ioPutU16LE(io, 1); // ch
  ioPutU16LE(io, 16); // bps
  ioPutUint32LE(io, 44100); // sps
  ioPutFloatLE(io, 1.0); // tuning
  ioPutUint32LE(io, 5); // data_size (2 フレーム + 1 バイト)
  io.write(new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55]), 1, 5);
  io.seek(0, 0);
  const w = new Woice();
  expect(w.ioMatePcmR(io)).toBe(PxtnErr.OK);
  expect(w.type).toBe(WoiceType.PCM);
  const vc = w.getVoice(0)!;
  expect(vc.pcm.smpBody).toBe(2);
  // C++ 同様、フレームに収まらない末尾の 1 バイトはバッファに入れない
  expect(Array.from(vc.pcm.pBuf!)).toEqual([0x11, 0x22, 0x33, 0x44]);
  // データ本体はストリームからすべて消費される
  expect(io.position).toBe(4 + 24 + 5);
});

it("toneReady renders 400-sample PTV cache", () => {
  const w = makePtvWoice();
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const vi = w.getInstance(0)!;
  expect(vi.smpBodyW).toBe(400);
  expect(vi.pSmpW!.length).toBe(400 * 2 * 2); // ch=2, bps=16
  expect(vi.envRelease).toBe(Math.trunc((1000 * 44100) / 60));
  expect(vi.pEnv!.length).toBeGreaterThan(0);
});

it("interpolates a descending envelope with C++ integer division", () => {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.envelope = {
    fps: 60,
    headNum: 3,
    bodyNum: 0,
    tailNum: 1,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 100 }, // 7350 サンプルで 0→100 へ上昇
      { x: 10, y: 0 }, // 7350 サンプルで 100→0 へ下降
      { x: 1000, y: 0 },
    ],
  };
  expect(w.toneReadyEnvelope(44100)).toBe(PxtnErr.OK);
  const env = w.getInstance(0)!.pEnv!;
  expect(env.length).toBe(14700);
  expect(env[7350]).toBe(100);
  // 下降中は start.y + int 除算になり、単純な切り捨てより 1 大きい
  expect(env[7351]).toBe(100);
  expect(env[7424]).toBe(99);
  expect(env[14699]).toBe(1);
});

it("keeps C++ envelope holes for interior zero points", () => {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.envelope = {
    fps: 60,
    headNum: 3,
    bodyNum: 0,
    tailNum: 1,
    points: [
      { x: 0, y: 50 },
      { x: 0, y: 0 }, // 中間のゼロ点は削除され、変換後の配列には穴 {0,0} が残る
      { x: 10, y: 100 },
      { x: 1000, y: 0 },
    ],
  };
  expect(w.toneReadyEnvelope(44100)).toBe(PxtnErr.OK);
  const env = w.getInstance(0)!.pEnv!;
  expect(env.length).toBe(7350);
  // C++ は穴を読んだ時点で開始値が {0,0} にリセットされ、以降は 0 のまま
  expect(env[0]).toBe(0);
  expect(env[100]).toBe(0);
  expect(env[7349]).toBe(0);
});