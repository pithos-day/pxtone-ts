// pxtnUnit.cpp 相当（1トラック分の再生状態）

import { PxtnErr } from "./error.js";
import { MemoryIo, asciiBytesToString, ioGetInt32LE, ioGetU16LE, ioGetBytes } from "./data.js";
import { i16At } from "./pcm.js";
import type { Woice, VoiceInstance } from "./woice.js";
import { PXTN_BASIC_SPS, PXTN_BUFSIZE_TIMEPAN, PXTN_MAX_CHANNEL, PXTN_MAX_TUNEWOICENAME, PXTN_MAX_UNIT_CONTROL_VOICE } from "./constants.js";
import {
  EVENTDEFAULT_GROUPNO,
  EVENTDEFAULT_KEY,
  EVENTDEFAULT_TUNING,
  EVENTDEFAULT_VELOCITY,
  EVENTDEFAULT_VOLUME,
  panToVolumes,
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
  // C++ _name_size (割り当てられた名前サイズ)。コンストラクタの "no name" で 7
  private _nameBufSize = "no name".length;
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

  setNameBuf(name: string | Uint8Array, bufSize?: number): boolean {
    const size = bufSize ?? name.length;
    if (size < 0 || size > PXTN_MAX_TUNEWOICENAME) return false;
    this._name = typeof name === "string" ? name : asciiBytesToString(name);
    this._nameBufSize = size;
    return true;
  }
  get name(): string {
    return this._name;
  }
  get nameBufSize(): number {
    return this._nameBufSize;
  }
  isNameBuf(): boolean {
    return this._nameBufSize > 0;
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
    this._panVols = ch === 2 ? panToVolumes(pan) : [64, 64];
  }

  tonePanTime(ch: number, pan: number, sps: number): void {
    this._panTimes[0] = 0;
    this._panTimes[1] = 0;
    if (ch === 2) {
      // 中央 64 から離れた側へパン時間を振る (最大 63)
      const target = pan >= 64 ? 0 : 1;
      const amount = pan >= 64 ? pan - 64 : 64 - pan;
      const clamped = amount > 63 ? 63 : amount;
      this._panTimes[target] = Math.trunc((clamped * PXTN_BASIC_SPS) / sps);
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
      if (vt.lifeCount <= 0 || !vi!.envSize) continue;
      if (vt.onCount > 0) {
        // 発音中: エンベロープテーブルを読み進める
        if (vt.envPos >= vi!.envSize) continue;
        vt.envVolume = vi!.pEnv![vt.envPos]!;
        vt.envPos++;
      } else {
        // リリース: 現在値から envRelease サンプルで 0 へ線形に減衰する
        vt.envVolume = vt.envStart + Math.trunc(((-vt.envStart) * vt.envPos) / vi!.envRelease);
        vt.envPos++;
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
    const voices = this._pWoice;
    for (let ch = 0; ch < PXTN_MAX_CHANNEL; ch++) {
      let timePanBuf = 0;
      for (let v = 0; v < num; v++) {
        const vt = this._vts[v]!;
        const vi = voices.getInstance(v)!;
        let work = 0;
        if (vt.lifeCount > 0) {
          // サンプル位置→バイト位置: 1 サンプル = 2ch × 16bit = 4 バイト、ch ごとに 2 バイト
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
          if (voices.getVoice(v)!.voiceFlags & PTV_VOICEFLAG_SMOOTH && vt.lifeCount < smoothSmp) {
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
        return this._keyNow;
      }
      // ポルタメント終端: 目標キーに到達して確定する
      this._keyStart += this._keyMargin;
      this._keyMargin = 0;
    }
    this._keyNow = this._keyStart + this._keyMargin;
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
            // ループ: 波形末尾を超えた分だけ巻き戻す (1 周で収まらない場合は 2 段階で処理)
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

  // size を読み捨て、type / group を読み取る。readName 時は名前 (16byte) も読み取る
  private readTypeAndGroup(io: MemoryIo, readName: boolean): { type: number; group: number } | null {
    const size = ioGetInt32LE(io);
    if (size === null) return null;
    void size;
    if (readName) {
      const name = ioGetBytes(io, 16);
      if (name === null) return null;
      // C++ Read_v1x は _name_buf にコピーするが _name_size は変えない (初期値 7 のまま)。
      // 表示内容のみ差し替え、書き出し長は nameBufSize (=7) のまま扱う
      this._name = asciiBytesToString(name);
    }
    const type = ioGetU16LE(io);
    if (type === null) return null;
    const group = ioGetU16LE(io);
    if (group === null) return null;
    return { type, group };
  }

  readV1x(io: MemoryIo, groupOut: { value: number }): boolean {
    const r = this.readTypeAndGroup(io, true);
    if (!r) return false;
    if (r.type !== WoiceType.PCM) return false;
    groupOut.value = r.group;
    return true;
  }

  readV3x(io: MemoryIo, groupOut: { value: number }): PxtnErr {
    const r = this.readTypeAndGroup(io, false);
    if (!r) return PxtnErr.DESC_R;
    if (r.type !== WoiceType.PCM && r.type !== WoiceType.PTV && r.type !== WoiceType.PTN)
      return PxtnErr.FMT_UNKNOWN;
    groupOut.value = r.group;
    return PxtnErr.OK;
  }
}

export { PXTN_BUFSIZE_TIMEPAN, PTV_VOICEFLAG_SMOOTH, PTV_VOICEFLAG_WAVELOOP };
export type { VoiceInstance };
