import { it, expect } from "vitest";
import { Unit } from "../src/unit.js";
import { Woice, VoiceType, PTV_VOICEFLAG_WAVELOOP, PTV_VOICEFLAG_SMOOTH } from "../src/woice.js";
import { Pcm } from "../src/pcm.js";
import { PxtnErr } from "../src/error.js";
import { MemoryIo, ioPutInt32LE, ioPutU16LE } from "../src/data.js";

function makePcmWoice(loop: boolean): Woice {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.type = VoiceType.Sampling;
  vc.basicKey = 0x4500;
  vc.volume = 128;
  vc.pan = 64;
  vc.tuning = 1.0;
  vc.voiceFlags = loop ? PTV_VOICEFLAG_WAVELOOP : 0;
  const p = new Pcm();
  p.create(1, 44100, 16, 8);
  const dv = new DataView(p.pBuf!.buffer);
  for (let i = 0; i < 8; i++) dv.setInt16(i * 2, (i + 1) * 500, true);
  vc.pcm = p;
  return w;
}

it("toneSample renders pan buffers with volume/velocity", () => {
  const w = makePcmWoice(true);
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneVolume(128);
  u.toneVelocity(128);
  u.toneResetAnd2prm(0, 0, 1);
  u.getTone(0).lifeCount = 100;
  u.toneSample(false, 2, 0, 0);
  expect(u.tonePanTimeBuf(0, 0)).toBe(500);
  expect(u.tonePanTimeBuf(1, 0)).toBe(500);
  u.toneSample(false, 1, 1, 0);
  expect(u.tonePanTimeBuf(0, 1)).toBe(500);
});

it("tonePanVolume pans stereo", () => {
  const w = makePcmWoice(true);
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneVolume(128);
  u.toneVelocity(128);
  u.toneResetAnd2prm(0, 0, 1);
  u.tonePanVolume(2, 96);
  u.getTone(0).lifeCount = 100;
  u.toneSample(false, 2, 0, 0);
  expect(u.tonePanTimeBuf(0, 0)).toBe(250); // (500 * 32) / 64
  expect(u.tonePanTimeBuf(1, 0)).toBe(500);
});

it("toneSupple adds to group respecting pan time", () => {
  const w = makePcmWoice(true);
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneVolume(128);
  u.toneVelocity(128);
  u.toneResetAnd2prm(0, 0, 1);
  u.tonePanTime(2, 64, 44100);
  u.getTone(0).lifeCount = 100;
  const group = new Int32Array(8);
  for (let i = 0; i < 8; i++) {
    u.toneSample(false, 2, i, 0);
    u.toneSupple(group, 0, i);
    u.toneSupple(group, 1, i);
  }
  expect(group[0]).toBe(500 * 8 * 2);
});

it("toneIncrementSample wraps with WAVELOOP and ends without", () => {
  const w = makePcmWoice(true);
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneResetAnd2prm(0, 0, 1);
  const t = u.getTone(0);
  t.lifeCount = 10000;
  t.onCount = 10000;
  for (let i = 0; i < 8; i++) u.toneIncrementSample(1);
  expect(t.smpPos).toBeCloseTo(0, 5); // wrapped back to 0

  const w2 = makePcmWoice(false);
  expect(w2.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u2 = new Unit();
  u2.setWoice(w2);
  u2.toneResetAnd2prm(0, 0, 1);
  const t2 = u2.getTone(0);
  t2.lifeCount = 10000;
  t2.onCount = 10000;
  for (let i = 0; i < 8; i++) u2.toneIncrementSample(1);
  expect(t2.lifeCount).toBe(0); // non-loop: killed at end
});

it("toneEnvelope ramps down after release", () => {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.basicKey = 0x4500;
  vc.volume = 128;
  vc.pan = 64;
  vc.type = VoiceType.Coodinate;
  vc.wave = {
    num: 5,
    reso: 64,
    points: [
      { x: 0, y: 0 },
      { x: 29, y: 0 },
      { x: 30, y: 64 },
      { x: 59, y: 64 },
      { x: 60, y: 0 },
    ],
  };
  vc.envelope = {
    fps: 60,
    headNum: 1,
    bodyNum: 0,
    tailNum: 1,
    points: [
      { x: 0, y: 64 },
      { x: 1000, y: 0 },
    ],
  };
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneResetAnd2prm(0, 0, 1);
  const t = u.getTone(0);
  t.lifeCount = 1000000;
  t.onCount = 1;
  u.toneEnvelope(); // head phase
  expect(t.envVolume).toBe(64);
  u.toneIncrementSample(1); // on_count -> 0, captures env_start
  expect(t.envStart).toBe(64);
  u.toneEnvelope(); // release ramp
  expect(t.envVolume).toBeLessThanOrEqual(64);
});

it("toneKey portamento glides", () => {
  const u = new Unit();
  u.toneKey(0x6000 + 120);
  u.tonePortament(100);
  for (let i = 0; i < 50; i++) u.toneIncrementKey();
  const mid = u.toneIncrementKey();
  expect(mid).toBeGreaterThan(0x6000);
  expect(mid).toBeLessThan(0x6000 + 120);
  for (let i = 0; i < 100; i++) u.toneIncrementKey();
  expect(u.toneIncrementKey()).toBe(0x6000 + 120);
});

it("readV3x parses group and rejects unknown types", () => {
  const io = new MemoryIo();
  ioPutInt32LE(io, 4);
  ioPutU16LE(io, 2); // PTV
  ioPutU16LE(io, 5);
  io.seek(0, 0);
  const u = new Unit();
  const g = { value: -1 };
  expect(u.readV3x(io, g)).toBe(PxtnErr.OK);
  expect(g.value).toBe(5);

  const io2 = new MemoryIo();
  ioPutInt32LE(io2, 4);
  ioPutU16LE(io2, 99);
  ioPutU16LE(io2, 0);
  io2.seek(0, 0);
  expect(u.readV3x(io2, g)).toBe(PxtnErr.FMT_UNKNOWN);
});