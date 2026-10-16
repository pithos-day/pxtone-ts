import { it, expect } from "vitest";
import { Oscillator } from "../src/osc.js";

const WAVE: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 29, y: 0 },
  { x: 30, y: 64 },
  { x: 59, y: 64 },
  { x: 60, y: 0 },
];

it("coodinate: interpolates between points and holds flat segments", () => {
  const o = new Oscillator();
  o.readyGetSample(WAVE, WAVE.length, 34, 400, 64);
  expect(o.getOneSampleCoodinate(0)).toBe(0);
  expect(o.getOneSampleCoodinate(188)).toBeCloseTo((64 * 34) / 128 / 128, 10); // 頂点 (30,64) の位置
  expect(o.getOneSampleCoodinate(300)).toBeCloseTo((64 * 34) / 128 / 128, 10); // 平坦部分 (y=64 一定)
  // 直線補間: (0,0)→(64,64) の斜辺の中点 (i = 64*200/400 = 32)
  const o2 = new Oscillator();
  o2.readyGetSample(
    [
      { x: 0, y: 0 },
      { x: 64, y: 64 },
    ],
    2,
    128,
    400,
    64,
  );
  expect(o2.getOneSampleCoodinate(200)).toBeCloseTo((32 * 128) / 128 / 128, 10);
});

it("coodinate: wraps from the last point to the first", () => {
  const o = new Oscillator();
  o.readyGetSample(WAVE, WAVE.length, 34, 400, 64);
  expect(o.getOneSampleCoodinate(399)).toBeCloseTo(0, 10); // 末端→先頭へラップ
});

it("overtone: Fourier sum with volume scaling", () => {
  const o = new Oscillator();
  o.readyGetSample([{ x: 1, y: 64 }], 1, 34, 400, 0);
  // sin(2π * 1 * 100 / 400) = sin(π/2) = 1 → 64/1/128 * 34/128 = 0.1328125
  expect(o.getOneSampleOvertone(100)).toBeCloseTo(0.1328125, 10);
  expect(o.getOneSampleOvertone(0)).toBeCloseTo(0, 10);
});
