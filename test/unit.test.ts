import { it, expect } from "vitest";
import { Unit } from "../src/unit.js";
import { Woice, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { PxtnErr } from "../src/error.js";
import { MemoryIo, ioPutInt32LE, ioPutU16LE } from "../src/data.js";
import { EVENTDEFAULT_KEY } from "../src/event.js";
import { makePcmWoice, makePtvWoice } from "./helpers.js";

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

it("toneIncrementSample wraps with WAVELOOP", () => {
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
});

it("toneIncrementSample ends the tone without WAVELOOP", () => {
  const w = makePcmWoice(false);
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const u = new Unit();
  u.setWoice(w);
  u.toneResetAnd2prm(0, 0, 1);
  const t = u.getTone(0);
  t.lifeCount = 10000;
  t.onCount = 10000;
  for (let i = 0; i < 8; i++) u.toneIncrementSample(1);
  expect(t.lifeCount).toBe(0); // non-loop: killed at end
});

it("toneEnvelope ramps down after release", () => {
  const w = makePtvWoice({ volume: 128 });
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
  u.toneKey(EVENTDEFAULT_KEY + 120);
  u.tonePortament(100);
  for (let i = 0; i < 50; i++) u.toneIncrementKey();
  const mid = u.toneIncrementKey();
  expect(mid).toBeGreaterThan(EVENTDEFAULT_KEY);
  expect(mid).toBeLessThan(EVENTDEFAULT_KEY + 120);
  for (let i = 0; i < 100; i++) u.toneIncrementKey();
  expect(u.toneIncrementKey()).toBe(EVENTDEFAULT_KEY + 120);
});

it("readV3x parses group", () => {
  const io = new MemoryIo();
  ioPutInt32LE(io, 4);
  ioPutU16LE(io, 2); // PTV
  ioPutU16LE(io, 5);
  io.seek(0, 0);
  const u = new Unit();
  const g = { value: -1 };
  expect(u.readV3x(io, g)).toBe(PxtnErr.OK);
  expect(g.value).toBe(5);
});

it("readV3x rejects unknown types", () => {
  const io = new MemoryIo();
  ioPutInt32LE(io, 4);
  ioPutU16LE(io, 99);
  ioPutU16LE(io, 0);
  io.seek(0, 0);
  const u = new Unit();
  const g = { value: -1 };
  expect(u.readV3x(io, g)).toBe(PxtnErr.FMT_UNKNOWN);
});
