// pxtnPulse_NoiseBuilder.cpp 相当（PTN→PCM レンダリング）

import { Pcm } from "./pcm.js";
import { Noise, WaveType, type NoiseUnit } from "./noise.js";
import { Frequency } from "./frequency.js";
import { Oscillator, type PulsePoint } from "./osc.js";
import { PxtnErr } from "./error.js";

const _BASIC_SPS = 44100.0;
const _BASIC_FREQUENCY = 100.0;
const _SAMPLING_TOP = 32767;
const _KEY_TOP = 0x3200;

const _smp_num_rand = 44100;
const _smp_num = Math.trunc(_BASIC_SPS / _BASIC_FREQUENCY); // 441

enum _RandomType {
  None = 0,
  Saw,
  Rect,
}

interface _Oscillator {
  increment: number;
  offset: number;
  volume: number;
  pSmp: Int16Array | null;
  bReverse: boolean;
  ranType: _RandomType;
  rdmStart: number;
  rdmMargin: number;
  rdmIndex: number;
}

interface _Point {
  smp: number;
  mag: number;
}

interface _Unit {
  bEnable: boolean;
  pan: [number, number];
  enveIndex: number;
  enveMagStart: number;
  enveMagMargin: number;
  enveCount: number;
  enveNum: number;
  enves: _Point[];
  main: _Oscillator;
  freq: _Oscillator;
  volu: _Oscillator;
}

function newOsc(): _Oscillator {
  return {
    increment: 0,
    offset: 0,
    volume: 0,
    pSmp: null,
    bReverse: false,
    ranType: _RandomType.None,
    rdmStart: 0,
    rdmMargin: 0,
    rdmIndex: 0,
  };
}

// 0 方向への切り捨て (負値も floor ではなく 0 側へ丸める)
function truncToZero(v: number): number {
  return v >= 0 ? Math.floor(v) : Math.ceil(v);
}

// work を [-1, 1] にクランプして int16 サンプル値へ変換する
function clampAndScale(work: number): number {
  if (work > 1.0) work = 1.0;
  if (work < -1.0) work = -1.0;
  return Math.trunc(work * _SAMPLING_TOP);
}

// ランダム系オシレータの現在値 (Saw: ランダム補間 / Rect: 区間先頭の値)
function sampleRandom(osc: _Oscillator): number {
  if (osc.ranType === _RandomType.Saw) return osc.rdmStart + (osc.rdmMargin * truncToZero(osc.offset)) / _smp_num;
  return osc.rdmStart;
}

function setOscillator(
  to: _Oscillator,
  from: NoiseUnit["main"],
  sps: number,
  tbl: Int16Array,
  tblRand: Int16Array,
): void {
  if (from.type === WaveType.Random) to.ranType = _RandomType.Saw;
  else if (from.type === WaveType.Random2) to.ranType = _RandomType.Rect;
  else to.ranType = _RandomType.None;

  to.increment = (_BASIC_SPS / sps) * (from.freq / _BASIC_FREQUENCY);
  if (to.ranType !== _RandomType.None) to.offset = 0;
  else to.offset = _smp_num * (from.offset / 100);
  to.volume = from.volume / 100;
  to.pSmp = tbl;
  to.bReverse = from.bRev;
  to.rdmStart = 0;
  to.rdmIndex = Math.trunc(_smp_num_rand * (from.offset / 100));
  to.rdmMargin = tblRand[to.rdmIndex]!;
}

function fillStairs(tbl: Int16Array, smpNum: number, nums: number[], vals: number[]): void {
  const den = nums[nums.length - 1]!;
  let s = 0;
  for (let i = 0; i < nums.length; i++) {
    const a = Math.trunc((smpNum * nums[i]!) / den);
    const v = vals[i]!;
    for (; s < a; s++) tbl[s] = v;
  }
}

export class NoiseBuilder {
  private _bInit = false;
  private _freq: Frequency | null = null;
  private _tables: (Int16Array | null)[] = [];
  private _randBuf = [0, 0];

  private _randomReset(): void {
    this._randBuf[0] = 0x4444;
    this._randBuf[1] = 0x8888;
  }

  private _randomGet(): number {
    const w1 = (this._randBuf[0]! << 16 >> 16) + this._randBuf[1]!;
    const s = w1 & 0xffff;
    const w2 = ((s & 0xff) << 8) | ((s >> 8) & 0xff);
    this._randBuf[1] = this._randBuf[0]!;
    this._randBuf[0] = w2 << 16 >> 16;
    return this._randBuf[0]!;
  }

  init(): boolean {
    if (this._bInit) return true;
    const freq = new Frequency();
    freq.init();
    this._freq = freq;
    const tbls: (Int16Array | null)[] = [];
    for (let s = 0; s < WaveType.num; s++) tbls.push(null);

    const alloc = (t: WaveType, n: number): Int16Array => (tbls[t] = new Int16Array(n));
    alloc(WaveType.None, _smp_num);
    alloc(WaveType.Sine, _smp_num);
    alloc(WaveType.Saw, _smp_num);
    alloc(WaveType.Rect, _smp_num);
    alloc(WaveType.Random, _smp_num_rand);
    alloc(WaveType.Saw2, _smp_num);
    alloc(WaveType.Rect2, _smp_num);
    alloc(WaveType.Tri, _smp_num);
    // Random2 は C++ と同様に未確保
    alloc(WaveType.Rect3, _smp_num);
    alloc(WaveType.Rect4, _smp_num);
    alloc(WaveType.Rect8, _smp_num);
    alloc(WaveType.Rect16, _smp_num);
    alloc(WaveType.Saw3, _smp_num);
    alloc(WaveType.Saw4, _smp_num);
    alloc(WaveType.Saw6, _smp_num);
    alloc(WaveType.Saw8, _smp_num);

    const osci = new Oscillator();

    // sine
    osci.readyGetSample([{ x: 1, y: 128 }], 1, 128, _smp_num, 0);
    {
      const p = tbls[WaveType.Sine]!;
      for (let s = 0; s < _smp_num; s++) p[s] = clampAndScale(osci.getOneSampleOvertone(s));
    }
    // saw down
    {
      const p = tbls[WaveType.Saw]!;
      const work = _SAMPLING_TOP + _SAMPLING_TOP; // 65534
      for (let s = 0; s < _smp_num; s++) {
        p[s] = Math.trunc(_SAMPLING_TOP - (work * s) / _smp_num);
      }
    }
    // rect
    {
      const p = tbls[WaveType.Rect]!;
      let s = 0;
      for (; s < _smp_num / 2; s++) p[s] = _SAMPLING_TOP;
      for (; s < _smp_num; s++) p[s] = -_SAMPLING_TOP;
    }
    // random
    {
      const p = tbls[WaveType.Random]!;
      this._randomReset();
      for (let s = 0; s < _smp_num_rand; s++) p[s] = this._randomGet();
    }
    // saw2
    {
      const overtones: PulsePoint[] = [];
      for (let i = 1; i <= 16; i++) overtones.push({ x: i, y: 128 });
      osci.readyGetSample(overtones, 16, 128, _smp_num, 0);
      const p = tbls[WaveType.Saw2]!;
      for (let s = 0; s < _smp_num; s++) p[s] = clampAndScale(osci.getOneSampleOvertone(s));
    }
    // rect2
    {
      const overtones: PulsePoint[] = [];
      for (let i = 1; i <= 15; i += 2) overtones.push({ x: i, y: 128 });
      osci.readyGetSample(overtones, 8, 128, _smp_num, 0);
      const p = tbls[WaveType.Rect2]!;
      for (let s = 0; s < _smp_num; s++) p[s] = clampAndScale(osci.getOneSampleOvertone(s));
    }
    // tri
    {
      const coodi: PulsePoint[] = [
        { x: 0, y: 0 },
        { x: _smp_num / 4, y: 128 },
        { x: (_smp_num * 3) / 4, y: -128 },
        { x: _smp_num, y: 0 },
      ];
      osci.readyGetSample(coodi, 4, 128, _smp_num, _smp_num);
      const p = tbls[WaveType.Tri]!;
      for (let s = 0; s < _smp_num; s++) p[s] = clampAndScale(osci.getOneSampleCoodinate(s));
    }
    // rect 3/4/8/16
    const RECT_WAVES: [number, WaveType][] = [
      [3, WaveType.Rect3],
      [4, WaveType.Rect4],
      [8, WaveType.Rect8],
      [16, WaveType.Rect16],
    ];
    for (const [n, wave] of RECT_WAVES) {
      const p = tbls[wave]!;
      let s = 0;
      for (; s < _smp_num / n; s++) p[s] = _SAMPLING_TOP;
      for (; s < _smp_num; s++) p[s] = -_SAMPLING_TOP;
    }
    // saw 3
    fillStairs(tbls[WaveType.Saw3]!, _smp_num, [1, 2, 3], [_SAMPLING_TOP, 0, -_SAMPLING_TOP]);
    // saw 4
    fillStairs(tbls[WaveType.Saw4]!, _smp_num, [1, 2, 3, 4], [
      _SAMPLING_TOP,
      _SAMPLING_TOP / 3,
      -_SAMPLING_TOP / 3,
      -_SAMPLING_TOP,
    ]);
    // saw 6
    fillStairs(tbls[WaveType.Saw6]!, _smp_num, [1, 2, 3, 4, 5, 6], [
      _SAMPLING_TOP,
      _SAMPLING_TOP - (_SAMPLING_TOP * 2) / 5,
      _SAMPLING_TOP / 5,
      -_SAMPLING_TOP / 5,
      -_SAMPLING_TOP + (_SAMPLING_TOP * 2) / 5,
      -_SAMPLING_TOP,
    ]);
    // saw 8
    fillStairs(tbls[WaveType.Saw8]!, _smp_num, [1, 2, 3, 4, 5, 6, 7, 8], [
      _SAMPLING_TOP,
      _SAMPLING_TOP - (_SAMPLING_TOP * 2) / 7,
      _SAMPLING_TOP - (_SAMPLING_TOP * 4) / 7,
      _SAMPLING_TOP / 7,
      -_SAMPLING_TOP / 7,
      -_SAMPLING_TOP + (_SAMPLING_TOP * 4) / 7,
      -_SAMPLING_TOP + (_SAMPLING_TOP * 2) / 7,
      -_SAMPLING_TOP,
    ]);

    this._tables = tbls;
    this._bInit = true;
    return true;
  }

  buildNoise(pNoise: Noise, ch: number, sps: number, bps: number): Pcm | null {
    if (!this._bInit) return null;
    pNoise.fix();

    const unitNum = pNoise.unitNum;
    const units: _Unit[] = [];
    for (let u = 0; u < unitNum; u++) {
      const srcUnit = pNoise.getUnit(u)!;
      const dstUnit: _Unit = {
        bEnable: srcUnit.bEnable,
        pan: [1, 1],
        enveIndex: 0,
        enveMagStart: 0,
        enveMagMargin: 0,
        enveCount: 0,
        enveNum: srcUnit.enveNum,
        enves: [],
        main: newOsc(),
        freq: newOsc(),
        volu: newOsc(),
      };
      // pan はパーセント値 (-100..100)。負で左、正で右チャンネルを減衰
      if (srcUnit.pan < 0) dstUnit.pan[1] = (100 + srcUnit.pan) / 100;
      else if (srcUnit.pan > 0) dstUnit.pan[0] = (100 - srcUnit.pan) / 100;
      for (let e = 0; e < srcUnit.enveNum; e++) {
        dstUnit.enves.push({
          smp: Math.trunc((sps * srcUnit.enves[e]!.x) / 1000),
          mag: srcUnit.enves[e]!.y / 100,
        });
      }
      this._skipZeroSmpEnvelope(dstUnit);
      setOscillator(dstUnit.main, srcUnit.main, sps, this._tables[srcUnit.main.type]!, this._tables[WaveType.Random]!);
      setOscillator(dstUnit.freq, srcUnit.freq, sps, this._tables[srcUnit.freq.type]!, this._tables[WaveType.Random]!);
      setOscillator(dstUnit.volu, srcUnit.volu, sps, this._tables[srcUnit.volu.type]!, this._tables[WaveType.Random]!);
      units.push(dstUnit);
    }

    const smpNum = Math.trunc(pNoise.smpNum44k / (_BASIC_SPS / sps));

    const pcm = new Pcm();
    if (pcm.create(ch, sps, bps, smpNum) !== PxtnErr.OK) return null;
    const p = pcm.pBuf!;
    const p16 = bps === 16 ? new Int16Array(p.buffer, p.byteOffset, p.byteLength >> 1) : null;

    for (let s = 0; s < smpNum; s++) {
      for (let c = 0; c < ch; c++) {
        let store = 0;
        for (let u = 0; u < unitNum; u++) {
          const dstUnit = units[u]!;
          if (!dstUnit.bEnable) continue;
          let work: number;
          // main
          const po = dstUnit.main;
          if (po.ranType === _RandomType.None) {
            const offset = truncToZero(po.offset);
            work = offset >= 0 ? po.pSmp![offset]! : 0;
          } else {
            work = po.offset >= 0 ? sampleRandom(po) : 0;
          }
          if (po.bReverse) work *= -1;
          work *= po.volume;
          // volu (C++ 互換: main と違い offset の負値ガードがない。負 offset 時は undefined になり得る)
          const volOsc = dstUnit.volu;
          const vol = volOsc.ranType === _RandomType.None ? volOsc.pSmp![truncToZero(volOsc.offset)]! : sampleRandom(volOsc);
          let volSample = vol;
          if (volOsc.bReverse) volSample *= -1;
          volSample *= volOsc.volume;

          work = (work * (volSample + _SAMPLING_TOP)) / (_SAMPLING_TOP * 2);
          work = work * dstUnit.pan[c]!;

          if (dstUnit.enveIndex < dstUnit.enveNum)
            work *= dstUnit.enveMagStart + (dstUnit.enveMagMargin * dstUnit.enveCount) / dstUnit.enves[dstUnit.enveIndex]!.smp;
          else work *= dstUnit.enveMagStart;
          store += work;
        }
        let sample = Math.trunc(store);
        if (sample > _SAMPLING_TOP) sample = _SAMPLING_TOP;
        if (sample < -_SAMPLING_TOP) sample = -_SAMPLING_TOP;
        if (bps === 8) p[s * ch + c] = (sample >> 8) + 128;
        else p16![s * ch + c] = sample;
      }

      // increment
      for (let u = 0; u < unitNum; u++) {
        const dstUnit = units[u]!;
        if (!dstUnit.bEnable) continue;
        // freq (C++ 互換: main と違い負 offset ガードなし。volu と同じ扱い)
        const freqOsc = dstUnit.freq;
        const fre = freqOsc.ranType === _RandomType.None
          ? (_KEY_TOP * freqOsc.pSmp![truncToZero(freqOsc.offset)]!) / _SAMPLING_TOP
          : sampleRandom(freqOsc);
        let freqSample = fre;
        if (freqOsc.bReverse) freqSample *= -1;
        freqSample *= freqOsc.volume;

        this._increment(dstUnit.main, dstUnit.main.increment * this._freq!.get(truncToZero(freqSample)), this._tables[WaveType.Random]!);
        this._increment(dstUnit.freq, dstUnit.freq.increment, this._tables[WaveType.Random]!);
        this._increment(dstUnit.volu, dstUnit.volu.increment, this._tables[WaveType.Random]!);

        if (dstUnit.enveIndex < dstUnit.enveNum) {
          dstUnit.enveCount++;
          if (dstUnit.enveCount >= dstUnit.enves[dstUnit.enveIndex]!.smp) {
            dstUnit.enveCount = 0;
            dstUnit.enveMagStart = dstUnit.enves[dstUnit.enveIndex]!.mag;
            dstUnit.enveMagMargin = 0;
            dstUnit.enveIndex++;
            this._skipZeroSmpEnvelope(dstUnit);
          }
        }
      }
    }
    return pcm;
  }

  // smp=0 のエンベロープ点は読み飛ばす (終端に達した点の値だけを引き継ぐ)
  private _skipZeroSmpEnvelope(dstUnit: _Unit): void {
    while (dstUnit.enveIndex < dstUnit.enveNum) {
      dstUnit.enveMagMargin = dstUnit.enves[dstUnit.enveIndex]!.mag - dstUnit.enveMagStart;
      if (dstUnit.enves[dstUnit.enveIndex]!.smp) break;
      dstUnit.enveMagStart = dstUnit.enves[dstUnit.enveIndex]!.mag;
      dstUnit.enveIndex++;
    }
  }

  private _increment(osc: _Oscillator, incr: number, randTable: Int16Array): void {
    osc.offset += incr;
    if (osc.offset > _smp_num) {
      osc.offset -= _smp_num;
      if (osc.offset >= _smp_num) osc.offset = 0;
      if (osc.ranType !== _RandomType.None) {
        osc.rdmStart = randTable[osc.rdmIndex]!;
        osc.rdmIndex++;
        if (osc.rdmIndex >= _smp_num_rand) osc.rdmIndex = 0;
        osc.rdmMargin = randTable[osc.rdmIndex]! - osc.rdmStart;
      }
    }
  }
}