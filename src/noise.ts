// pxtnPulse_Noise.cpp 相当（PTNノイズデータ保持 + セーブ/ロード）
// pxtnPulse_Noise.h の pxNOISEDESIGN_* / pxWAVETYPE を含む

import { PxtnErr } from "./error.js";
import { MemoryIo, SEEK_CUR, dataCheckVSize, dataReadV, dataWriteV, ioGetInt8, ioGetUint32LE, ioPutU8, ioPutUint32LE } from "./data.js";
import type { PulsePoint } from "./osc.js";

export enum WaveType {
  None = 0,
  Sine,
  Saw,
  Rect,
  Random,
  Saw2,
  Rect2,
  Tri,
  Random2,
  Rect3,
  Rect4,
  Rect8,
  Rect16,
  Saw3,
  Saw4,
  Saw6,
  Saw8,
  num,
}

export interface NoiseOscillator {
  type: WaveType;
  freq: number;
  volume: number;
  offset: number;
  bRev: boolean;
}

export interface NoiseUnit {
  bEnable: boolean;
  enveNum: number;
  enves: PulsePoint[];
  pan: number;
  main: NoiseOscillator;
  freq: NoiseOscillator;
  volu: NoiseOscillator;
}

const NOISEDESIGNLIMIT_SMPNUM = 48000 * 10;
const NOISEDESIGNLIMIT_ENVE_X = 1000 * 10;
const NOISEDESIGNLIMIT_ENVE_Y = 100;
const NOISEDESIGNLIMIT_OSC_FREQUENCY = 44100.0;
const NOISEDESIGNLIMIT_OSC_VOLUME = 200.0;
const NOISEDESIGNLIMIT_OSC_OFFSET = 100.0;

const MAX_NOISEEDITUNITNUM = 4;
const MAX_NOISEEDITENVELOPENUM = 3;

const NOISEEDITFLAG_ENVELOPE = 0x0004;
const NOISEEDITFLAG_PAN = 0x0008;
const NOISEEDITFLAG_OSC_MAIN = 0x0010;
const NOISEEDITFLAG_OSC_FREQ = 0x0020;
const NOISEEDITFLAG_OSC_VOLU = 0x0040;
const NOISEEDITFLAG_UNCOVERED = 0xffffff83;

const NOISE_FILEID = "PTNOISE-";
const NOISE_VERSION = 20120418;

function fixOscillator(osc: NoiseOscillator): void {
  if (osc.type >= WaveType.num) osc.type = WaveType.None;
  if (osc.freq > NOISEDESIGNLIMIT_OSC_FREQUENCY) osc.freq = NOISEDESIGNLIMIT_OSC_FREQUENCY;
  if (osc.freq <= 0) osc.freq = 0;
  if (osc.volume > NOISEDESIGNLIMIT_OSC_VOLUME) osc.volume = NOISEDESIGNLIMIT_OSC_VOLUME;
  if (osc.volume <= 0) osc.volume = 0;
  if (osc.offset > NOISEDESIGNLIMIT_OSC_OFFSET) osc.offset = NOISEDESIGNLIMIT_OSC_OFFSET;
  if (osc.offset <= 0) osc.offset = 0;
}

export class Noise {
  private _smpNum44k = 0;
  private _unitNum = 0;
  private _units: NoiseUnit[] = [];

  setSmpNum44k(num: number): void {
    this._smpNum44k = num;
  }
  get unitNum(): number {
    return this._unitNum;
  }
  get smpNum44k(): number {
    return this._smpNum44k;
  }
  get sec(): number {
    return this._smpNum44k / 44100;
  }

  getUnit(u: number): NoiseUnit | null {
    if (u < 0 || u >= this._unitNum) return null;
    return this._units[u]!;
  }

  fix(): void {
    if (this._smpNum44k > NOISEDESIGNLIMIT_SMPNUM) this._smpNum44k = NOISEDESIGNLIMIT_SMPNUM;
    for (let i = 0; i < this._unitNum; i++) {
      const unit = this._units[i]!;
      if (unit.bEnable) {
        for (let e = 0; e < unit.enveNum; e++) {
          const pnt = unit.enves[e]!;
          if (pnt.x > NOISEDESIGNLIMIT_ENVE_X) pnt.x = NOISEDESIGNLIMIT_ENVE_X;
          if (pnt.x < 0) pnt.x = 0;
          if (pnt.y > NOISEDESIGNLIMIT_ENVE_Y) pnt.y = NOISEDESIGNLIMIT_ENVE_Y;
          if (pnt.y < 0) pnt.y = 0;
        }
        if (unit.pan < -100) unit.pan = -100;
        if (unit.pan > 100) unit.pan = 100;
        fixOscillator(unit.main);
        fixOscillator(unit.freq);
        fixOscillator(unit.volu);
      }
    }
  }

  private writeOscillator(osc: NoiseOscillator, io: MemoryIo, add: number): number | null {
    const vals: number[] = [
      osc.type,
      osc.bRev ? 1 : 0,
      Math.trunc(osc.freq * 10),
      Math.trunc(osc.volume * 10),
      Math.trunc(osc.offset * 10),
    ];
    for (const v of vals) {
      if (!dataWriteV(io, v)) return null;
      add += dataCheckVSize(v);
    }
    return add;
  }

  private readOscillator(osc: NoiseOscillator, io: MemoryIo): PxtnErr {
    const t = dataReadV(io);
    if (t === null) return PxtnErr.DESC_R;
    osc.type = t;
    if (osc.type >= WaveType.num) return PxtnErr.FMT_UNKNOWN;
    const b = dataReadV(io);
    if (b === null) return PxtnErr.DESC_R;
    osc.bRev = b !== 0;
    const f = dataReadV(io);
    if (f === null) return PxtnErr.DESC_R;
    osc.freq = f / 10;
    const v = dataReadV(io);
    if (v === null) return PxtnErr.DESC_R;
    osc.volume = v / 10;
    const o = dataReadV(io);
    if (o === null) return PxtnErr.DESC_R;
    osc.offset = o / 10;
    return PxtnErr.OK;
  }

  private makeFlags(unit: NoiseUnit): number {
    let flags = NOISEEDITFLAG_ENVELOPE;
    if (unit.pan) flags |= NOISEEDITFLAG_PAN;
    if (unit.main.type !== WaveType.None) flags |= NOISEEDITFLAG_OSC_MAIN;
    if (unit.freq.type !== WaveType.None) flags |= NOISEEDITFLAG_OSC_FREQ;
    if (unit.volu.type !== WaveType.None) flags |= NOISEEDITFLAG_OSC_VOLU;
    return flags;
  }

  write(io: MemoryIo, pAdd?: number): boolean {
    // C++ の *p_add は現在の IO 位置（絶対バイト数）に一致すると仮定
    let seek = pAdd ?? io.position;
    if (!writeAscii(io, NOISE_FILEID)) return false;
    ioPutUint32LE(io, NOISE_VERSION);
    seek += 12;
    if (!dataWriteV(io, this._smpNum44k)) return false;
    seek += dataCheckVSize(this._smpNum44k);
    ioPutU8(io, 0);
    const numSeek = seek;
    seek += 1;

    let unitNum = 0;
    for (let u = 0; u < this._unitNum; u++) {
      const unit = this._units[u]!;
      if (!unit.bEnable) continue;
      const flags = this.makeFlags(unit);
      if (!dataWriteV(io, flags)) return false;
      seek += dataCheckVSize(flags);
      if (flags & NOISEEDITFLAG_ENVELOPE) {
        if (!dataWriteV(io, unit.enveNum)) return false;
        seek += dataCheckVSize(unit.enveNum);
        for (let e = 0; e < unit.enveNum; e++) {
          const pnt = unit.enves[e]!;
          if (!dataWriteV(io, pnt.x)) return false;
          seek += dataCheckVSize(pnt.x);
          if (!dataWriteV(io, pnt.y)) return false;
          seek += dataCheckVSize(pnt.y);
        }
      }
      if (flags & NOISEEDITFLAG_PAN) {
        ioPutU8(io, unit.pan & 0xff);
        seek += 1;
      }
      if (flags & NOISEEDITFLAG_OSC_MAIN) {
        const s = this.writeOscillator(unit.main, io, seek);
        if (s === null) return false;
        seek = s;
      }
      if (flags & NOISEEDITFLAG_OSC_FREQ) {
        const s = this.writeOscillator(unit.freq, io, seek);
        if (s === null) return false;
        seek = s;
      }
      if (flags & NOISEEDITFLAG_OSC_VOLU) {
        const s = this.writeOscillator(unit.volu, io, seek);
        if (s === null) return false;
        seek = s;
      }
      unitNum++;
    }

    // 先頭の unit_num を書き戻す
    if (!io.seek(SEEK_CUR, numSeek - seek)) return false;
    ioPutU8(io, unitNum);
    if (!io.seek(SEEK_CUR, seek - numSeek - 1)) return false;
    return true;
  }

  read(io: MemoryIo): PxtnErr {
    this.release();
    const code = readAsciiExact(io, 8);
    if (code === null) return PxtnErr.DESC_R;
    if (code !== NOISE_FILEID) return PxtnErr.INV_CODE;
    const ver = ioGetUint32LE(io);
    if (ver === null) return PxtnErr.DESC_R;
    if (ver > NOISE_VERSION) return PxtnErr.FMT_NEW;
    const smp = dataReadV(io);
    if (smp === null) return PxtnErr.DESC_R;
    this._smpNum44k = smp;
    const unitNumByte = ioGetInt8(io);
    if (unitNumByte === null) return PxtnErr.DESC_R;
    if (unitNumByte < 0) return PxtnErr.INV_DATA;
    if (unitNumByte > MAX_NOISEEDITUNITNUM) return PxtnErr.FMT_UNKNOWN;
    this._unitNum = unitNumByte;
    this._units = [];
    for (let u = 0; u < this._unitNum; u++) this._units.push(newUnit());

    for (let u = 0; u < this._unitNum; u++) {
      const unit = this._units[u]!;
      unit.bEnable = true;
      const flags = dataReadV(io);
      if (flags === null) return PxtnErr.DESC_R;
      if (flags & NOISEEDITFLAG_UNCOVERED) return PxtnErr.FMT_UNKNOWN;
      if (flags & NOISEEDITFLAG_ENVELOPE) {
        const en = dataReadV(io);
        if (en === null) return PxtnErr.DESC_R;
        unit.enveNum = en;
        if (unit.enveNum > MAX_NOISEEDITENVELOPENUM) return PxtnErr.FMT_UNKNOWN;
        unit.enves = [];
        for (let e = 0; e < unit.enveNum; e++) {
          const x = dataReadV(io);
          if (x === null) return PxtnErr.DESC_R;
          const y = dataReadV(io);
          if (y === null) return PxtnErr.DESC_R;
          unit.enves.push({ x, y });
        }
      }
      if (flags & NOISEEDITFLAG_PAN) {
        const b = ioGetInt8(io);
        if (b === null) return PxtnErr.DESC_R;
        unit.pan = b;
      }
      if (flags & NOISEEDITFLAG_OSC_MAIN) {
        const r = this.readOscillator(unit.main, io);
        if (r !== PxtnErr.OK) return r;
      }
      if (flags & NOISEEDITFLAG_OSC_FREQ) {
        const r = this.readOscillator(unit.freq, io);
        if (r !== PxtnErr.OK) return r;
      }
      if (flags & NOISEEDITFLAG_OSC_VOLU) {
        const r = this.readOscillator(unit.volu, io);
        if (r !== PxtnErr.OK) return r;
      }
    }
    return PxtnErr.OK;
  }

  release(): void {
    this._units = [];
    this._unitNum = 0;
  }

  allocate(unitNum: number, envelopeNum: number): boolean {
    this.release();
    this._unitNum = unitNum;
    this._units = [];
    for (let u = 0; u < unitNum; u++) {
      const unit = newUnit();
      unit.enveNum = envelopeNum;
      for (let e = 0; e < envelopeNum; e++) unit.enves.push({ x: 0, y: 0 });
      this._units.push(unit);
    }
    return true;
  }

  copyFrom(src: Noise): boolean {
    this.release();
    this._smpNum44k = src._smpNum44k;
    if (src._unitNum) {
      const enveNum = src._units[0]!.enveNum;
      if (!this.allocate(src._unitNum, enveNum)) return false;
      for (let u = 0; u < src._unitNum; u++) {
        const dst = this._units[u]!;
        const s = src._units[u]!;
        dst.bEnable = s.bEnable;
        dst.enveNum = s.enveNum;
        dst.freq = { ...s.freq };
        dst.main = { ...s.main };
        dst.pan = s.pan;
        dst.volu = { ...s.volu };
        dst.enves = s.enves.slice();
      }
    }
    return true;
  }

  compare(src: Noise): number {
    if (!src) return -1;
    if (src._smpNum44k !== this._smpNum44k) return 1;
    if (src._unitNum !== this._unitNum) return 1;
    for (let u = 0; u < this._unitNum; u++) {
      const su = src._units[u]!;
      const tu = this._units[u]!;
      if (su.bEnable !== tu.bEnable) return 1;
      if (su.enveNum !== tu.enveNum) return 1;
      if (su.pan !== tu.pan) return 1;
      if (compareOsci(su.main, tu.main)) return 1;
      if (compareOsci(su.freq, tu.freq)) return 1;
      if (compareOsci(su.volu, tu.volu)) return 1;
      for (let e = 0; e < this._units[u]!.enveNum; e++) {
        // C++ はここで unit 自身同士を比較する実装バグがあるが、挙動を維持する
        if (tu.enves[e]!.x !== tu.enves[e]!.x) return 1;
        if (tu.enves[e]!.y !== tu.enves[e]!.y) return 1;
      }
    }
    return 0;
  }
}

function newUnit(): NoiseUnit {
  return {
    bEnable: false,
    enveNum: 0,
    enves: [],
    pan: 0,
    main: { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false },
    freq: { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false },
    volu: { type: WaveType.None, freq: 0, volume: 0, offset: 0, bRev: false },
  };
}

function compareOsci(a: NoiseOscillator, b: NoiseOscillator): number {
  if (a.type !== b.type) return 1;
  if (a.freq !== b.freq) return 1;
  if (a.volume !== b.volume) return 1;
  if (a.offset !== b.offset) return 1;
  if (a.bRev !== b.bRev) return 1;
  return 0;
}

function writeAscii(io: MemoryIo, s: string): boolean {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return io.write(b, 1, s.length);
}

function readAsciiExact(io: MemoryIo, n: number): string | null {
  if (io.remain < n) return null;
  const b = new Uint8Array(n);
  if (!io.read(b, 1, n)) return null;
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
}