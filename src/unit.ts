// pxtnUnit.cpp 相当（1トラック分の再生状態）

import { PxtnErr } from "./error.js";
import { MemoryIo, ioGetInt32LE, ioGetU16LE, ioGetBytes } from "./data.js";
import type { Woice, VoiceInstance } from "./woice.js";
import { PXTN_BUFSIZE_TIMEPAN, PXTN_MAX_CHANNEL, PXTN_MAX_TUNEWOICENAME, PXTN_MAX_UNIT_CONTROL_VOICE } from "./constants.js";
import {
  EVENTDEFAULT_GROUPNO,
  EVENTDEFAULT_KEY,
  EVENTDEFAULT_TUNING,
  EVENTDEFAULT_VELOCITY,
  EVENTDEFAULT_VOLUME,
} from "./event.js";
import { PTV_VOICEFLAG_SMOOTH, PTV_VOICEFLAG_WAVELOOP, WoiceType } from "./woice.js";

export interface VoiceTone {
  smpPos: number;
  offsetFreq: number;
  envVolume: number;
  lifeCount: number;
  onCount: number;
  smpCount: number;
  envStart: number;
  envPos: number;
  envReleaseClock: number;
  smoothVolume: number;
}

function newTone(): VoiceTone {
  return {
    smpPos: 0,
    offsetFreq: 0,
    envVolume: 0,
    lifeCount: 0,
    onCount: 0,
    smpCount: 0,
    envStart: 0,
    envPos: 0,
    envReleaseClock: 0,
    smoothVolume: 0,
  };
}

export class Unit {
  private _bOperated = true;
  private _bPlayed = true;
  private _name = "no name";
  private _keyNow = EVENTDEFAULT_KEY;
  private _keyStart = EVENTDEFAULT_KEY;
  private _keyMargin = 0;
  private _portamentSamplePos = 0;
  private _portamentSampleNum = 0;
  private _panVols: number[] = [64, 64];
  private _panTimes: number[] = [0, 0];
  private _panTimeBufs: number[][] = [new Array(PXTN_BUFSIZE_TIMEPAN).fill(0), new Array(PXTN_BUFSIZE_TIMEPAN).fill(0)];
  private _vVolume = EVENTDEFAULT_VOLUME;
  private _vVelocity = EVENTDEFAULT_VELOCITY;
  private _vGroupNo = EVENTDEFAULT_GROUPNO;
  private _vTuning = EVENTDEFAULT_TUNING;
  private _pWoice: Woice | null = null;
  private _vts: VoiceTone[] = [newTone(), newTone()];

  toneInit(): void {
    this._vGroupNo = EVENTDEFAULT_GROUPNO;
    this._vVelocity = EVENTDEFAULT_VELOCITY;
    this._vVolume = EVENTDEFAULT_VOLUME;
    this._vTuning = EVENTDEFAULT_TUNING;
    this._portamentSampleNum = 0;
    this._portamentSamplePos = 0;
    for (let i = 0; i < PXTN_MAX_CHANNEL; i++) {
      this._panVols[i] = 64;
      this._panTimes[i] = 0;
    }
  }

  toneClear(): void {
    for (let i = 0; i < PXTN_MAX_CHANNEL; i++) this._panTimeBufs[i]!.fill(0);
  }

  toneResetAnd2prm(voiceIdx: number, envRlsClock: number, offsetFreq: number): void {
    const t = this._vts[voiceIdx]!;
    t.lifeCount = 0;
    t.onCount = 0;
    t.smpPos = 0;
    t.smoothVolume = 0;
    t.envReleaseClock = envRlsClock;
    t.offsetFreq = offsetFreq;
  }

  setWoice(pWoice: Woice): boolean {
    if (!pWoice) return false;
    this._pWoice = pWoice;
    this._keyNow = EVENTDEFAULT_KEY;
    this._keyMargin = 0;
    this._keyStart = EVENTDEFAULT_KEY;
    return true;
  }
  get woice(): Woice | null {
    return this._pWoice;
  }

  setNameBuf(name: string | Uint8Array): boolean {
    const size = typeof name === "string" ? name.length : name.length;
    if (size > PXTN_MAX_TUNEWOICENAME) return false;
    if (typeof name === "string") this._name = name;
    else {
      let s = "";
      for (const c of name) {
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      this._name = s;
    }
    return true;
  }
  get name(): string {
    return this._name;
  }
  isNameBuf(): boolean {
    return this._name.length > 0;
  }

  setOperated(b: boolean): void {
    this._bOperated = b;
  }
  setPlayed(b: boolean): void {
    this._bPlayed = b;
  }
  get operated(): boolean {
    return this._bOperated;
  }
  get played(): boolean {
    return this._bPlayed;
  }

  toneZeroLives(): void {
    for (let i = 0; i < PXTN_MAX_CHANNEL; i++) this._vts[i]!.lifeCount = 0;
  }

  toneKeyOn(): void {
    this._keyNow = this._keyStart + this._keyMargin;
    this._keyStart = this._keyNow;
    this._keyMargin = 0;
  }

  toneKey(key: number): void {
    this._keyStart = this._keyNow;
    this._keyMargin = key - this._keyStart;
    this._portamentSamplePos = 0;
  }

  tonePanVolume(ch: number, pan: number): void {
    this._panVols[0] = 64;
    this._panVols[1] = 64;
    if (ch === 2) {
      if (pan >= 64) this._panVols[0] = 128 - pan;
      else this._panVols[1] = pan;
    }
  }

  tonePanTime(ch: number, pan: number, sps: number): void {
    this._panTimes[0] = 0;
    this._panTimes[1] = 0;
    if (ch === 2) {
      if (pan >= 64) {
        this._panTimes[0] = pan - 64;
        if (this._panTimes[0]! > 63) this._panTimes[0] = 63;
        this._panTimes[0] = Math.trunc((this._panTimes[0]! * 44100) / sps);
      } else {
        this._panTimes[1] = 64 - pan;
        if (this._panTimes[1]! > 63) this._panTimes[1] = 63;
        this._panTimes[1] = Math.trunc((this._panTimes[1]! * 44100) / sps);
      }
    }
  }

  toneVelocity(val: number): void {
    this._vVelocity = val;
  }
  toneVolume(val: number): void {
    this._vVolume = val;
  }
  tonePortament(val: number): void {
    this._portamentSampleNum = val;
  }
  toneGroupNo(val: number): void {
    this._vGroupNo = val;
  }
  toneTuning(val: number): void {
    this._vTuning = val;
  }

  toneEnvelope(): void {
    if (!this._pWoice) return;
    const num = this._pWoice.voiceNum;
    for (let v = 0; v < num; v++) {
      const vi = this._pWoice.getInstance(v);
      const vt = this._vts[v]!;
      if (vt.lifeCount > 0 && vi!.envSize) {
        if (vt.onCount > 0) {
          if (vt.envPos < vi!.envSize) {
            vt.envVolume = vi!.pEnv![vt.envPos]!;
            vt.envPos++;
          }
        } else {
          vt.envVolume = vt.envStart + Math.trunc(((0 - vt.envStart) * vt.envPos) / vi!.envRelease);
          vt.envPos++;
        }
      }
    }
  }

  toneSample(bMuteByUnit: boolean, chNum: number, timePanIndex: number, smoothSmp: number): void {
    if (!this._pWoice) return;
    if (bMuteByUnit && !this._bPlayed) {
      for (let ch = 0; ch < chNum; ch++) this._panTimeBufs[ch]![timePanIndex] = 0;
      return;
    }
    const num = this._pWoice.voiceNum;
    for (let ch = 0; ch < PXTN_MAX_CHANNEL; ch++) {
      let timePanBuf = 0;
      for (let v = 0; v < num; v++) {
        const vt = this._vts[v]!;
        const vi = this._pWoice.getInstance(v)!;
        let work = 0;
        if (vt.lifeCount > 0) {
          const pos = Math.trunc(vt.smpPos) * 4 + ch * 2;
          work += i16At(vi.pSmpW!, pos);
          if (chNum === 1) {
            work += i16At(vi.pSmpW!, pos + 2);
            work = Math.trunc(work / 2);
          }
          work = Math.trunc((work * this._vVelocity) / 128);
          work = Math.trunc((work * this._vVolume) / 128);
          work = Math.trunc((work * this._panVols[ch]!) / 64);
          if (vi.envSize) work = Math.trunc((work * vt.envVolume) / 128);
          if (this._pWoice.getVoice(v)!.voiceFlags & PTV_VOICEFLAG_SMOOTH && vt.lifeCount < smoothSmp) {
            work = Math.trunc((work * vt.lifeCount) / smoothSmp);
          }
        }
        timePanBuf += work;
      }
      this._panTimeBufs[ch]![timePanIndex] = timePanBuf;
    }
  }

  toneSupple(groupSmps: Int32Array, ch: number, timePanIndex: number): void {
    const idx = (timePanIndex - this._panTimes[ch]!) & (PXTN_BUFSIZE_TIMEPAN - 1);
    groupSmps[this._vGroupNo]! += this._panTimeBufs[ch]![idx]!;
  }

  toneIncrementKey(): number {
    if (this._portamentSampleNum && this._keyMargin) {
      if (this._portamentSamplePos < this._portamentSampleNum) {
        this._portamentSamplePos++;
        this._keyNow = Math.trunc(this._keyStart + (this._keyMargin * this._portamentSamplePos) / this._portamentSampleNum);
      } else {
        this._keyNow = this._keyStart + this._keyMargin;
        this._keyStart = this._keyNow;
        this._keyMargin = 0;
      }
    } else {
      this._keyNow = this._keyStart + this._keyMargin;
    }
    return this._keyNow;
  }

  toneIncrementSample(freq: number): void {
    if (!this._pWoice) return;
    const num = this._pWoice.voiceNum;
    for (let v = 0; v < num; v++) {
      const vi = this._pWoice.getInstance(v)!;
      const vt = this._vts[v]!;
      if (vt.lifeCount > 0) vt.lifeCount--;
      if (vt.lifeCount > 0) {
        vt.onCount--;
        vt.smpPos += vt.offsetFreq * this._vTuning * freq;
        if (vt.smpPos >= vi.smpBodyW) {
          if (this._pWoice.getVoice(v)!.voiceFlags & PTV_VOICEFLAG_WAVELOOP) {
            if (vt.smpPos >= vi.smpBodyW) vt.smpPos -= vi.smpBodyW;
            if (vt.smpPos >= vi.smpBodyW) vt.smpPos = 0;
          } else {
            vt.lifeCount = 0;
          }
        }
        if (vt.onCount === 0 && vi.envSize) {
          vt.envStart = vt.envVolume;
          vt.envPos = 0;
        }
      }
    }
  }

  getTone(voiceIdx: number): VoiceTone {
    return this._vts[voiceIdx]!;
  }

  tonePanTimeBuf(ch: number, idx: number): number {
    return this._panTimeBufs[ch]![idx]!;
  }

  readV1x(io: MemoryIo, groupOut: { value: number }): boolean {
    const size = ioGetInt32LE(io);
    if (size === null) return false;
    void size;
    const name = ioGetBytes(io, 16);
    if (name === null) return false;
    const type = ioGetU16LE(io);
    if (type === null) return false;
    const group = ioGetU16LE(io);
    if (group === null) return false;
    if (type !== WoiceType.PCM) return false;
    this.setNameBuf(name);
    groupOut.value = group;
    return true;
  }

  readV3x(io: MemoryIo, groupOut: { value: number }): PxtnErr {
    const size = ioGetInt32LE(io);
    if (size === null) return PxtnErr.DESC_R;
    void size;
    const type = ioGetU16LE(io);
    if (type === null) return PxtnErr.DESC_R;
    const group = ioGetU16LE(io);
    if (group === null) return PxtnErr.DESC_R;
    if (type !== WoiceType.PCM && type !== WoiceType.PTV && type !== WoiceType.PTN)
      return PxtnErr.FMT_UNKNOWN;
    groupOut.value = group;
    return PxtnErr.OK;
  }
}

function i16At(buf: Uint8Array, pos: number): number {
  return (buf[pos]! | (buf[pos + 1]! << 8)) << 16 >> 16;
}

export { PXTN_BUFSIZE_TIMEPAN, PTV_VOICEFLAG_SMOOTH, PTV_VOICEFLAG_WAVELOOP };
export type { VoiceInstance };