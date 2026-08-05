import { it, expect } from "vitest";
import { MemoryIo } from "../src/data.js";
import { Noise, WaveType } from "../src/noise.js";
import { PxtnErr } from "../src/error.js";

function makeNoise(): Noise {
  const n = new Noise();
  n.setSmpNum44k(44100);
  n.allocate(1, 2);
  const u = n.getUnit(0)!;
  u.bEnable = true;
  u.pan = -30;
  u.enves = [
    { x: 0, y: 0 },
    { x: 1000, y: 90 },
  ];
  u.main = { type: WaveType.Saw, freq: 440.5, volume: 88.5, offset: 12.3, bRev: false };
  u.freq = { type: WaveType.Sine, freq: 1, volume: 0.5, offset: 0, bRev: true };
  u.volu = { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false };
  return n;
}

it("round trips PTN blob", () => {
  const n = makeNoise();
  const io = new MemoryIo();
  expect(n.write(io)).toBe(true);
  const m = new Noise();
  io.seek(0, 0);
  expect(m.read(io)).toBe(PxtnErr.OK);
  expect(m.smpNum44k).toBe(44100);
  expect(m.unitNum).toBe(1);
  const u = m.getUnit(0)!;
  expect(u.bEnable).toBe(true);
  expect(u.pan).toBe(-30);
  expect(u.enves).toEqual([
    { x: 0, y: 0 },
    { x: 1000, y: 90 },
  ]);
  expect(u.main.type).toBe(WaveType.Saw);
  expect(u.main.freq).toBe(440.5);
  expect(u.main.volume).toBe(88.5);
  expect(u.main.offset).toBe(12.3);
  expect(u.freq.bRev).toBe(true);
  expect(n.compare(m)).toBe(0);
});

it("rejects unsupported version/flags", () => {
  const io = new MemoryIo();
  io.write(new Uint8Array(8).map((_, i) => "PTNOISE-".charCodeAt(i)), 1, 8);
  io.write(new Uint8Array([0xff, 0xff, 0xff, 0x7f]), 1, 4); // バージョン巨大
  const n = new Noise();
  // ver > 最新 → fmt_new
  io.seek(0, 0);
  expect(n.read(io)).toBe(PxtnErr.FMT_NEW);
});

it("fix clamps out-of-range values", () => {
  const n = new Noise();
  n.setSmpNum44k(48000 * 11);
  n.allocate(1, 1);
  const u = n.getUnit(0)!;
  u.bEnable = true;
  u.enves[0] = { x: 99999, y: -5 };
  u.main = { type: WaveType.Sine, freq: 999999, volume: 500, offset: 300, bRev: false };
  u.pan = 500;
  n.fix();
  expect(n.smpNum44k).toBe(48000 * 10);
  expect(u.enves[0]).toEqual({ x: 1000 * 10, y: 0 });
  expect(u.main.freq).toBe(44100);
  expect(u.main.volume).toBe(200);
  expect(u.main.offset).toBe(100);
  expect(u.pan).toBe(100);
});