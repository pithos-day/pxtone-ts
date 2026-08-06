// pxtnPulse_Frequency.cpp 相当（音高テーブル）

import { EVENTDEFAULT_KEY } from "./event.js";

const _OCTAVE_NUM = 16;
const _KEY_PER_OCTAVE = 12;
const _FREQUENCY_PER_KEY = 0x10;
const _TABLE_SIZE = _OCTAVE_NUM * _KEY_PER_OCTAVE * _FREQUENCY_PER_KEY;

const _OCT_TABLE: readonly number[] = [
  0.00390625, // 0  -8
  0.0078125, // 1  -7
  0.015625, // 2  -6
  0.03125, // 3  -5
  0.0625, // 4  -4
  0.125, // 5  -3
  0.25, // 6  -2
  0.5, // 7  -1
  1, // 8
  2, // 9  1
  4, // a  2
  8, // b  3
  16, // c  4
  32, // d  5
  64, // e  6
  128, // f  7
];

// 2^(1/divisionsPerOctave) を17桁で 10進近似
function getDivideOctaveRate(divisionsPerOctave: number): number {
  let approx = 1.0;
  for (let i = 0; i < 17; i++) {
    let step = 1;
    for (let j = 0; j < i; j++) step = step * 0.1;
    let j = 0;
    for (; j < 10; j++) {
      const candidate = approx + step * j;
      let product = 1.0;
      let k = 0;
      for (; k < divisionsPerOctave; k++) {
        product *= candidate;
        if (product >= 2.0) break;
      }
      if (k !== divisionsPerOctave) break;
    }
    approx += step * (j - 1);
  }
  return approx;
}

export class Frequency {
  private _freqTable: Float32Array;

  constructor() {
    this._freqTable = new Float32Array(_TABLE_SIZE);
  }

  init(): void {
    const octX24 = getDivideOctaveRate(_KEY_PER_OCTAVE * _FREQUENCY_PER_KEY);
    const perOct = _KEY_PER_OCTAVE * _FREQUENCY_PER_KEY;
    for (let f = 0; f < _TABLE_SIZE; f++) {
      let work = _OCT_TABLE[Math.trunc(f / perOct)]!;
      const rem = f % perOct;
      for (let key = 0; key < rem; key++) work *= octX24;
      this._freqTable[f] = work;
    }
  }

  get(key: number): number {
    let i = Math.trunc(((key + EVENTDEFAULT_KEY) * _FREQUENCY_PER_KEY) / 0x100);
    if (i < 0) i = 0;
    else if (i >= _TABLE_SIZE) i = _TABLE_SIZE - 1;
    return this._freqTable[i]!;
  }

  get2(key: number): number {
    let i = key >> 4;
    if (i < 0) i = 0;
    else if (i >= _TABLE_SIZE) i = _TABLE_SIZE - 1;
    return this._freqTable[i]!;
  }

  getTable(): Float32Array {
    return this._freqTable;
  }
}