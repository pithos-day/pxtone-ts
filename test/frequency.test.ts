import { it, expect } from "vitest";
import { Frequency } from "../src/frequency.js";

function f32Hex(v: number): string {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, v, true);
  return new DataView(buf).getUint32(0, true).toString(16).padStart(8, "0");
}

it("builds the frequency table faithfully", () => {
  const f = new Frequency();
  f.init();
  const t = f.getTable();
  const expected: Record<number, string> = {
    0: "3b800000",
    1: "3b807683",
    2: "3b80ed73",
    16: "3b879c7d",
    191: "3bff13d5",
    192: "3c000000",
    1000: "3e13e299",
    1536: "3f800000",
    1537: "3f807683",
    1552: "3f879c7d",
    2048: "40cb2ff5",
    3071: "437f13d5",
  };
  for (const [i, hex] of Object.entries(expected)) {
    expect(f32Hex(t[Number(i)]!)).toBe(hex);
  }
  expect(t.length).toBe(16 * 12 * 16);
});

it("Get / Get2 resolve keys into the table with clamping", () => {
  const f = new Frequency();
  f.init();
  // (0x6000+0x6000)*16/256 = 3072 → clamp to末尾
  expect(f.get(0x6000)).toBe(f.getTable()[3071]!);
  // key>>4 = 1536 → オクターブ8基準=1.0
  expect(f.get2(0x6000)).toBe(1.0);
  // 最低/最高クランプ
  expect(f.get2(-0x100000)).toBe(f.getTable()[0]!);
  expect(f.get2(0x7fffffff)).toBe(f.getTable()[3071]!);
  // 半音(2^(1/12))は i=1552 で検証済みの倍率
  const ratio = f.getTable()[1552]! / f.getTable()[1536]!;
  expect(ratio).toBeCloseTo(Math.pow(2, 1 / 12), 5);
});