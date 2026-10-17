import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Noise, WaveType, type NoiseOscillator } from "../src/noise.js";
import { NoiseBuilder } from "../src/noise-builder.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";

// init 後の内部波形テーブル (ビルド結果) を取り出す
function tablesOf(nb: NoiseBuilder): Int16Array[] {
  return (nb as unknown as { _tables: Int16Array[] })._tables;
}

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
  const tables = tablesOf(nb);
  expect(tables[WaveType.Rect]![219]).toBe(32767);
  expect(tables[WaveType.Rect]![220]).toBe(-32767);
  expect(tables[WaveType.Rect4]![109]).toBe(32767);
  expect(tables[WaveType.Rect4]![110]).toBe(-32767);
  expect(tables[WaveType.Rect8]![54]).toBe(32767);
  expect(tables[WaveType.Rect8]![55]).toBe(-32767);
  expect(tables[WaveType.Rect16]![26]).toBe(32767);
  expect(tables[WaveType.Rect16]![27]).toBe(-32767);
});

it("matches C++ triangle wave peak positions", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  // C++ は頂点を int 除算で 110 / 330 の位置に置く
  const tables = tablesOf(nb);
  expect(tables[WaveType.Tri]![109]).toBe(32469);
  expect(tables[WaveType.Tri]![110]).toBe(32767);
  expect(tables[WaveType.Tri]![330]).toBe(-32767);
  expect(tables[WaveType.Tri]![331]).toBe(-32471);
});

it("matches C++ saw6 wave step values", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  // C++ は _SAMPLING_TOP*2/5 を int 除算するため段値が 19661 / -19661 になる
  const tables = tablesOf(nb);
  expect(tables[WaveType.Saw6]![73]).toBe(19661);
  expect(tables[WaveType.Saw6]![146]).toBe(19661);
  expect(tables[WaveType.Saw6]![147]).toBe(6553);
  expect(tables[WaveType.Saw6]![220]).toBe(-6553);
  expect(tables[WaveType.Saw6]![293]).toBe(-6553);
  expect(tables[WaveType.Saw6]![294]).toBe(-19661);
});

// ---- オシレータ境界外参照バグの回帰テスト ----
// 本家 C++ は offset=100 で p_tbl_rand を、位相 441 ちょうどで p_tbl を 1 要素読み越し
// (未定義動作)。移植では sampleTable により周期内に折り返した定義済み挙動に統一し、
// NaN 伝播による完全無音と周期的な 0 サンプル混入が再発しないことを担保する。

const BASS4_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "bass4.ptnoise");

const NONE_OSC: NoiseOscillator = { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false };

function makeDesign(
  main: NoiseOscillator,
  freq: NoiseOscillator,
  volu: NoiseOscillator,
  smpNum44k = 8820,
): Noise {
  const n = new Noise();
  n.setSmpNum44k(smpNum44k);
  n.allocate(1, 2);
  const u = n.getUnit(0)!;
  u.bEnable = true;
  u.enves = [
    { x: 0, y: 100 },
    { x: 1000, y: 100 },
  ];
  u.main = main;
  u.freq = freq;
  u.volu = volu;
  return n;
}

type BuiltPcm = NonNullable<ReturnType<NoiseBuilder["buildNoise"]>>;

function sample16Of(pcm: BuiltPcm): number[] {
  const dv = new DataView(pcm.pBuf!.buffer, pcm.pBuf!.byteOffset, pcm.pBuf!.byteLength);
  const total = pcm.pBuf!.byteLength >> 1;
  const out: number[] = [];
  for (let i = 0; i < total; i++) out.push(dv.getInt16(i * 2, true));
  return out;
}

function firstNonZeroOf(samples: number[]): number {
  const index = samples.findIndex((v) => v !== 0);
  if (index < 0) throw new Error("all samples are zero");
  return index;
}

it("renders audible noise when a Random oscillator has offset=100", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);

  // main が Random: 修正前は初期 rdm_index が範囲外参照となり NaN → 冒頭が無音 (recover まで ~883 samples)
  const mainRandom = sample16Of(
    nb.buildNoise(makeDesign({ type: WaveType.Random, freq: 44100, volume: 100, offset: 100, bRev: false }, NONE_OSC, NONE_OSC), 1, 44100, 16)!,
  );
  expect(firstNonZeroOf(mainRandom)).toBeLessThanOrEqual(2);

  // freq が Random (bass4.ptnoise のパターン): 修正前は main.offset が NaN になり全サンプル 0
  const freqRandom = sample16Of(
    nb.buildNoise(
      makeDesign(
        { type: WaveType.Sine, freq: 100, volume: 100, offset: 0, bRev: false },
        { type: WaveType.Random, freq: 43, volume: 80, offset: 100, bRev: false },
        NONE_OSC,
      ),
      1,
      44100,
      16,
    )!,
  );
  expect(freqRandom.some((v) => v !== 0)).toBe(true);

  // volu が Random: 修正前は振幅側の参照が NaN → 周期境界まで無音
  const voluRandom = sample16Of(
    nb.buildNoise(
      makeDesign(
        { type: WaveType.Sine, freq: 100, volume: 100, offset: 0, bRev: false },
        NONE_OSC,
        { type: WaveType.Random, freq: 44100, volume: 100, offset: 100, bRev: false },
      ),
      1,
      44100,
      16,
    )!,
  );
  expect(firstNonZeroOf(voluRandom)).toBeLessThanOrEqual(2);
});

it("non-Random oscillator with offset=100 wraps the boundary slot (no dropouts, same as offset=0)", () => {
  // 修正前は位相 441 にちょうど一致したサンプルで p_tbl 範囲外を参照し 0 が混入していた
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  for (const type of [WaveType.Saw, WaveType.Rect]) {
    const off100 = sample16Of(nb.buildNoise(makeDesign({ type, freq: 100, volume: 100, offset: 100, bRev: false }, NONE_OSC, NONE_OSC), 1, 44100, 16)!);
    const off0 = sample16Of(nb.buildNoise(makeDesign({ type, freq: 100, volume: 100, offset: 0, bRev: false }, NONE_OSC, NONE_OSC), 1, 44100, 16)!);
    // 位相 441 は周期先頭に折り返すため off=100 ≡ off=0 (0 の落下・混入なし)
    expect(off100.some((v) => v === 0)).toBe(false);
    expect(off100).toEqual(off0);
  }
});

it("builds the bass4.ptnoise fixture as audible noise (freq: Random offset=100)", () => {
  const nb = new NoiseBuilder();
  expect(nb.init()).toBe(true);
  const n = new Noise();
  expect(n.read(new MemoryIo(new Uint8Array(readFileSync(BASS4_PATH))))).toBe(PxtnErr.OK);
  // 実データ: 3 unit とも main=Sine / freq=Random(offset=100) / volu=None
  const pcm = nb.buildNoise(n, 2, 44100, 16)!;
  const samples = sample16Of(pcm);
  // 修正前は全サンプル 0 (完全無音)
  expect(samples.some((v) => v !== 0)).toBe(true);
  // 40ms のフルスケール減衰ノイズ → 以後エンベロープにより無音
  expect(samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0)).toBe(32767);
  expect(samples.slice(4000).every((v) => v === 0)).toBe(true);
});
