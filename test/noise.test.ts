import { it, expect } from "vitest";
import { MemoryIo, ioPutAsciiString, ioPutU8 } from "../src/data.js";
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
  // C++ のフィールドは float のため、12.3 は float32 値として読み戻される
  expect(u.main.offset).toBe(Math.fround(12.3));
  expect(u.freq.bRev).toBe(true);
  expect(n.compare(m)).toBe(0);
});

it("round-trips float32 oscillator values for every file offset", () => {
  // C++ は osc パラメータを float で保持し、書き出しも float 乗算 (int)(freq*10) のため、
  // 読込→保存の往復でファイル値 (offset*10) が変わらないことを全 1001 値で確認する
  for (let w = 0; w <= 1000; w++) {
    const n = new Noise();
    n.setSmpNum44k(441);
    n.allocate(1, 1);
    const u = n.getUnit(0)!;
    u.bEnable = true;
    u.enves = [{ x: 0, y: 100 }];
    u.main = { type: WaveType.Sine, freq: 100, volume: 100, offset: w / 10, bRev: false };

    const io = new MemoryIo();
    expect(n.write(io), `offset=${w}`).toBe(true);
    const m = new Noise();
    io.seek(0, 0);
    expect(m.read(io), `offset=${w}`).toBe(PxtnErr.OK);
    // read は float32 へ丸めて保持する
    expect(m.getUnit(0)!.main.offset, `offset=${w}`).toBe(Math.fround(w / 10));
    // write 側も float 乗算でなければ 398/1001 の値で 1 小さく保存されてしまう
    expect(n.compare(m), `offset=${w}`).toBe(0);
  }
});

it("rejects unsupported version", () => {
  const io = new MemoryIo();
  ioPutAsciiString(io, "PTNOISE-");
  io.write(new Uint8Array([0xff, 0xff, 0xff, 0x7f]), 1, 4); // バージョン巨大
  const n = new Noise();
  // ver > 最新 → fmt_new
  io.seek(0, 0);
  expect(n.read(io)).toBe(PxtnErr.FMT_NEW);
});

it("releases partial state when read fails like C++", () => {
  const io = new MemoryIo();
  ioPutAsciiString(io, "PTNOISE-");
  io.write(new Uint8Array([0x62, 0x03, 0x33, 0x01]), 1, 4); // _ver 20120418 (LE)
  ioPutU8(io, 0); // smp_num_44k = 0 (varint)
  ioPutU8(io, 1); // unit_num = 1
  // ここで終端: flags が読めず DESC_R になる
  io.seek(0, 0);
  const n = new Noise();
  expect(n.read(io)).toBe(PxtnErr.DESC_R);
  // C++ は失敗時 Release() するため部分状態 (unit_num=1) が残らない
  expect(n.unitNum).toBe(0);
  expect(n.getUnit(0)).toBeNull();
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

it("copyFrom copies envelope points by value", () => {
  const src = makeNoise();
  const dst = new Noise();
  expect(dst.copyFrom(src)).toBe(true);
  // C++ 同様、コピー元の点を後から書き換えてもコピー先に影響しない
  src.getUnit(0)!.enves[0]!.x = 999;
  expect(dst.getUnit(0)!.enves[0]!.x).toBe(0);
});
