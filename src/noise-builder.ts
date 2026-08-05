// pxtnPulse_NoiseBuilder.cpp 相当（PTN→PCM レンダリング）

import { Pcm } from "./pcm.js";
import { Noise, WaveType, type NoiseUnit } from "./noise.js";
import { Frequency } from "./frequency.js";
import { Oscillator, type PulsePoint } from "./osc.js";

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

function getInt(v: number): number {
  return v >= 0 ? Math.floor(v) : Math.ceil(v);
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
      for (let s = 0; s < _smp_num; s++) {
        let work = osci.getOneSampleOvertone(s);
        if (work > 1.0) work = 1.0;
        if (work < -1.0) work = -1.0;
        p[s] = Math.trunc(work * _SAMPLING_TOP);
      }
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
      for (let s = 0; s < _smp_num; s++) {
        let work = osci.getOneSampleOvertone(s);
        if (work > 1.0) work = 1.0;
        if (work < -1.0) work = -1.0;
        p[s] = Math.trunc(work * _SAMPLING_TOP);
      }
    }
    // rect2
    {
      const overtones: PulsePoint[] = [];
      for (let i = 1; i <= 15; i += 2) overtones.push({ x: i, y: 128 });
      osci.readyGetSample(overtones, 8, 128, _smp_num, 0);
      const p = tbls[WaveType.Rect2]!;
      for (let s = 0; s < _smp_num; s++) {
        let work = osci.getOneSampleOvertone(s);
        if (work > 1.0) work = 1.0;
        if (work < -1.0) work = -1.0;
        p[s] = Math.trunc(work * _SAMPLING_TOP);
      }
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
      for (let s = 0; s < _smp_num; s++) {
        let work = osci.getOneSampleCoodinate(s);
        if (work > 1.0) work = 1.0;
        if (work < -1.0) work = -1.0;
        p[s] = Math.trunc(work * _SAMPLING_TOP);
      }
    }
    // rect 3/4/8/16
    for (const n of [3, 4, 8, 16] as const) {
      const wave = n === 3 ? WaveType.Rect3 : n === 4 ? WaveType.Rect4 : n === 8 ? WaveType.Rect8 : WaveType.Rect16;
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
      const du = pNoise.getUnit(u)!;
      const pU: _Unit = {
        bEnable: du.bEnable,
        pan: [1, 1],
        enveIndex: 0,
        enveMagStart: 0,
        enveMagMargin: 0,
        enveCount: 0,
        enveNum: du.enveNum,
        enves: [],
        main: newOsc(),
        freq: newOsc(),
        volu: newOsc(),
      };
      if (du.pan === 0) {
        pU.pan[0] = 1;
        pU.pan[1] = 1;
      } else if (du.pan < 0) {
        pU.pan[0] = 1;
        pU.pan[1] = (100 + du.pan) / 100;
      } else {
        pU.pan[1] = 1;
        pU.pan[0] = (100 - du.pan) / 100;
      }
      for (let e = 0; e < du.enveNum; e++) {
        pU.enves.push({
          smp: Math.trunc((sps * du.enves[e]!.x) / 1000),
          mag: du.enves[e]!.y / 100,
        });
      }
      while (pU.enveIndex < pU.enveNum) {
        pU.enveMagMargin = pU.enves[pU.enveIndex]!.mag - pU.enveMagStart;
        if (pU.enves[pU.enveIndex]!.smp) break;
        pU.enveMagStart = pU.enves[pU.enveIndex]!.mag;
        pU.enveIndex++;
      }
      setOscillator(pU.main, du.main, sps, this._tables[du.main.type]!, this._tables[WaveType.Random]!);
      setOscillator(pU.freq, du.freq, sps, this._tables[du.freq.type]!, this._tables[WaveType.Random]!);
      setOscillator(pU.volu, du.volu, sps, this._tables[du.volu.type]!, this._tables[WaveType.Random]!);
      units.push(pU);
    }

    const smpNum = Math.trunc(pNoise.smpNum44k / (44100.0 / sps));

    const pcm = new Pcm();
    if (pcm.create(ch, sps, bps, smpNum) !== 0) return null;
    const p = pcm.pBuf!;
    const p16 = bps === 16 ? new Int16Array(p.buffer, p.byteOffset, p.byteLength >> 1) : null;

    let pos = 0;
    for (let s = 0; s < smpNum; s++) {
      for (let c = 0; c < ch; c++) {
        let store = 0;
        for (let u = 0; u < unitNum; u++) {
          const pU = units[u]!;
          if (!pU.bEnable) continue;
          let po: _Oscillator;
          let work: number;
          // main
          po = pU.main;
          if (po.ranType === _RandomType.None) {
            const offset = getInt(po.offset);
            work = offset >= 0 ? po.pSmp![offset]! : 0;
          } else if (po.ranType === _RandomType.Saw) {
            work = po.offset >= 0 ? po.rdmStart + (po.rdmMargin * getInt(po.offset)) / _smp_num : 0;
          } else {
            work = po.offset >= 0 ? po.rdmStart : 0;
          }
          if (po.bReverse) work *= -1;
          work *= po.volume;
          // volu
          let vol: number;
          po = pU.volu;
          if (po.ranType === _RandomType.None) {
            const offset = getInt(po.offset);
            vol = po.pSmp![offset]!;
          } else if (po.ranType === _RandomType.Saw) {
            vol = po.rdmStart + (po.rdmMargin * getInt(po.offset)) / _smp_num;
          } else {
            vol = po.rdmStart;
          }
          if (po.bReverse) vol *= -1;
          vol *= po.volume;

          work = (work * (vol + _SAMPLING_TOP)) / (_SAMPLING_TOP * 2);
          work = work * pU.pan[c]!;

          if (pU.enveIndex < pU.enveNum)
            work *= pU.enveMagStart + (pU.enveMagMargin * pU.enveCount) / pU.enves[pU.enveIndex]!.smp;
          else work *= pU.enveMagStart;
          store += work;
        }
        let sample = Math.trunc(store);
        if (sample > _SAMPLING_TOP) sample = _SAMPLING_TOP;
        if (sample < -_SAMPLING_TOP) sample = -_SAMPLING_TOP;
        if (bps === 8) {
          p[pos] = (sample >> 8) + 128;
          pos += 1;
        } else {
          p16![s * ch + c] = sample;
        }
      }

      // increment
      for (let u = 0; u < unitNum; u++) {
        const pU = units[u]!;
        if (!pU.bEnable) continue;
        let po = pU.freq;
        let fre: number;
        if (po.ranType === _RandomType.None) {
          const offset = getInt(po.offset);
          fre = (_KEY_TOP * po.pSmp![offset]!) / _SAMPLING_TOP;
        } else if (po.ranType === _RandomType.Saw) {
          fre = po.rdmStart + (po.rdmMargin * getInt(po.offset)) / _smp_num;
        } else {
          fre = po.rdmStart;
        }
        if (po.bReverse) fre *= -1;
        fre *= po.volume;

        this._increment(pU.main, pU.main.increment * this._freq!.get(getInt(fre)), this._tables[WaveType.Random]!);
        this._increment(pU.freq, pU.freq.increment, this._tables[WaveType.Random]!);
        this._increment(pU.volu, pU.volu.increment, this._tables[WaveType.Random]!);

        if (pU.enveIndex < pU.enveNum) {
          pU.enveCount++;
          if (pU.enveCount >= pU.enves[pU.enveIndex]!.smp) {
            pU.enveCount = 0;
            pU.enveMagStart = pU.enves[pU.enveIndex]!.mag;
            pU.enveMagMargin = 0;
            pU.enveIndex++;
            while (pU.enveIndex < pU.enveNum) {
              pU.enveMagMargin = pU.enves[pU.enveIndex]!.mag - pU.enveMagStart;
              if (pU.enves[pU.enveIndex]!.smp) break;
              pU.enveMagStart = pU.enves[pU.enveIndex]!.mag;
              pU.enveIndex++;
            }
          }
        }
      }
    }
    void pos;
    return pcm;
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