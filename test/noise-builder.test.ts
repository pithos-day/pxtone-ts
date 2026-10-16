import { it, expect } from "vitest";
import { Noise, WaveType } from "../src/noise.js";
import { NoiseBuilder } from "../src/noise-builder.js";

function buildSineNoise(): Noise {
  const n = new Noise();
  n.allocate(1, 2);
  const u = n.getUnit(0)!;
  u.bEnable = true;
  u.enves = [
    { x: 0, y: 100 },
    { x: 1000, y: 100 },
  ];
  u.main = { type: WaveType.Sine, freq: 100, volume: 100, offset: 0, bRev: false };
  u.freq = { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false };
  u.volu = { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false };
  return n;
}

it("renders a 100Hz sine wave at 44.1kHz", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  const n = buildSineNoise();
  n.setSmpNum44k(44100);
  const pcm = nb.buildNoise(n, 1, 44100, 16)!;
  expect(pcm).not.toBeNull();
  expect(pcm.smpBody).toBe(44100);
  const dv = new DataView(pcm.pBuf!.buffer);
  // 周波数100Hz→周期441サンプル：周期性を検証
  for (let i = 0; i < 400; i++) {
    expect(dv.getInt16(i * 2, true)).toBe(dv.getInt16((i + 441) * 2, true));
  }
  // ピークは main 振幅 32767 * 1.0(volu0→1/2) ≈ 16383
  let peak = 0;
  for (let i = 0; i < 44100; i++) peak = Math.max(peak, Math.abs(dv.getInt16(i * 2, true)));
  expect(peak).toBeGreaterThan(16000);
  expect(peak).toBeLessThan(16400);
});

it("silent when envelope is zero point", () => {
  const nb = new NoiseBuilder();
  nb.init();
  const n = buildSineNoise();
  n.setSmpNum44k(4410);
  const u = n.getUnit(0)!;
  u.enveNum = 1;
  u.enves = [{ x: 0, y: 0 }];
  const pcm = nb.buildNoise(n, 1, 44100, 16)!;
  const dv = new DataView(pcm.pBuf!.buffer);
  let max = 0;
  for (let i = 0; i < pcm.smpBody; i++) max = Math.max(max, Math.abs(dv.getInt16(i * 2, true)));
  expect(max).toBe(0);
});

it("8bit build centers around 128", () => {
  const nb = new NoiseBuilder();
  nb.init();
  const n = buildSineNoise();
  n.setSmpNum44k(8820);
  const pcm = nb.buildNoise(n, 1, 44100, 8)!;
  expect(pcm.bps).toBe(8);
  const b = pcm.pBuf!;
  let hi = 128;
  let lo = 128;
  for (let i = 0; i < pcm.smpBody; i++) {
    hi = Math.max(hi, b[i]!);
    lo = Math.min(lo, b[i]!);
  }
  expect(hi).toBeGreaterThanOrEqual(190);
  expect(lo).toBeLessThanOrEqual(66);
});

it("matches C++ integer division in random oscillators", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  const n = new Noise();
  n.setSmpNum44k(882);
  n.allocate(1, 1);
  const u = n.getUnit(0)!;
  u.bEnable = true;
  u.pan = 0;
  u.enves = [{ x: 0, y: 100 }];
  u.main = { type: WaveType.Random, freq: 44100, volume: 100, offset: 0, bRev: false };
  u.freq = { type: WaveType.Random, freq: 44100, volume: 100, offset: 0, bRev: false };
  u.volu = { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false };
  const pcm = nb.buildNoise(n, 1, 44100, 16)!;
  const dv = new DataView(pcm.pBuf!.buffer);
  // C++ 実装 (pxtnPulse_NoiseBuilder) の出力値
  const expected = [
    0, -6554, -6124, -5675, 2056, -4370, -4086, -3801, -3078, -2355, -2418, -2617, -2691, -2764, -2785, -2806,
  ];
  for (let i = 0; i < expected.length; i++) {
    expect(dv.getInt16(i * 2, true), `i=${i}`).toBe(expected[i]);
  }
});

it("matches C++ rect wave boundaries", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  // C++ の int 除算では 441/2=220, 441/4=110, 441/8=55, 441/16=27 の位置から負値になる
  const tables = (nb as unknown as { _tables: Int16Array[] })._tables;
  expect(tables[WaveType.Rect]![219]).toBe(32767);
  expect(tables[WaveType.Rect]![220]).toBe(-32767);
  expect(tables[WaveType.Rect4]![109]).toBe(32767);
  expect(tables[WaveType.Rect4]![110]).toBe(-32767);
  expect(tables[WaveType.Rect8]![54]).toBe(32767);
  expect(tables[WaveType.Rect8]![55]).toBe(-32767);
  expect(tables[WaveType.Rect16]![26]).toBe(32767);
  expect(tables[WaveType.Rect16]![27]).toBe(-32767);
});