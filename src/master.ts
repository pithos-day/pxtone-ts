// pxtnMaster 相当（曲メタ）

import { PxtnErr } from "./error.js";
import { EventKind, EVENTDEFAULT_BEATNUM, EVENTDEFAULT_BEATTEMPO, EVENTDEFAULT_BEATCLOCK } from "./event.js";
import type { MemoryIo } from "./data.js";
import {
  SEEK_SET,
  SEEK_CUR,
  ioGetInt8,
  ioGetInt16LE,
  ioGetInt32LE,
  ioGetFloatLE,
  ioGetUint16LE,
  ioGetUint32LE,
  ioPutFloatLE,
  ioPutInt8,
  ioPutInt16LE,
  ioPutInt32LE,
  ioPutUint32LE,
  dataReadV,
  int32ToFloat,
} from "./data.js";

export class Master {
  private _beat_num = EVENTDEFAULT_BEATNUM;
  private _beat_tempo = EVENTDEFAULT_BEATTEMPO;
  private _beat_clock = EVENTDEFAULT_BEATCLOCK;
  private _meas_num = 1;
  private _repeat_meas = 0;
  private _last_meas = 0;

  reset(): void {
    this._beat_num = EVENTDEFAULT_BEATNUM;
    this._beat_tempo = EVENTDEFAULT_BEATTEMPO;
    this._beat_clock = EVENTDEFAULT_BEATCLOCK;
    this._meas_num = 1;
    this._repeat_meas = 0;
    this._last_meas = 0;
  }

  set(beatNum: number, beatTempo: number, beatClock: number): void {
    this._beat_num = beatNum;
    this._beat_tempo = beatTempo;
    this._beat_clock = beatClock;
  }

  get beatNum(): number {
    return this._beat_num;
  }
  get beatTempo(): number {
    return this._beat_tempo;
  }
  get beatClock(): number {
    return this._beat_clock;
  }
  get measNum(): number {
    return this._meas_num;
  }
  get repeatMeas(): number {
    return this._repeat_meas;
  }
  get lastMeas(): number {
    return this._last_meas;
  }

  get lastClock(): number {
    return this._last_meas * this._beat_clock * this._beat_num;
  }

  get playMeas(): number {
    if (this._last_meas) return this._last_meas;
    return this._meas_num;
  }

  setMeasNum(measNum: number): void {
    if (measNum < 1) measNum = 1;
    if (measNum <= this._repeat_meas) measNum = this._repeat_meas + 1;
    if (measNum < this._last_meas) measNum = this._last_meas;
    this._meas_num = measNum;
  }

  setRepeatMeas(meas: number): void {
    if (meas < 0) meas = 0;
    this._repeat_meas = meas;
  }

  setLastMeas(meas: number): void {
    if (meas < 0) meas = 0;
    this._last_meas = meas;
  }

  setBeatClock(beatClock: number): void {
    if (beatClock < 0) beatClock = 0;
    this._beat_clock = beatClock;
  }

  getThisClock(meas: number, beat: number, clock: number): number {
    return this._beat_num * this._beat_clock * meas + this._beat_clock * beat + clock;
  }

  adjustMeasNum(clock: number): void {
    const bNum = Math.trunc((clock + this._beat_clock - 1) / this._beat_clock);
    const mNum = Math.trunc((bNum + this._beat_num - 1) / this._beat_num);
    if (this._meas_num <= mNum) this._meas_num = mNum;
    if (this._repeat_meas >= this._meas_num) this._repeat_meas = 0;
    if (this._last_meas > this._meas_num) this._last_meas = this._meas_num;
  }

  // 15byte固定 + size（quantizeBits は .ptcop 読み込み時は 1）
  ioWV5(desc: MemoryIo, quantizeBits: number): boolean {
    const size = 15;
    const bClock = Math.trunc(this._beat_clock / quantizeBits);
    ioPutUint32LE(desc, size);
    ioPutInt16LE(desc, bClock);
    ioPutInt8(desc, this._beat_num);
    ioPutFloatLE(desc, this._beat_tempo);
    ioPutInt32LE(desc, bClock * this._beat_num * this.repeatMeas);
    ioPutInt32LE(desc, bClock * this._beat_num * this.lastMeas);
    return true;
  }

  ioRV5(desc: MemoryIo): PxtnErr {
    const size = ioGetUint32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 15) return PxtnErr.FMT_UNKNOWN;

    const beatClock = ioGetInt16LE(desc);
    const beatNum = ioGetInt8(desc);
    const beatTempo = ioGetFloatLE(desc);
    const clockRepeat = ioGetInt32LE(desc);
    const clockLast = ioGetInt32LE(desc);
    if (beatClock === null || beatNum === null || beatTempo === null || clockRepeat === null || clockLast === null) {
      return PxtnErr.DESC_R;
    }

    this._beat_clock = beatClock;
    this._beat_num = beatNum;
    this._beat_tempo = beatTempo;

    if (beatNum * beatClock) {
      this.setRepeatMeas(Math.trunc(clockRepeat / (beatNum * beatClock)));
      this.setLastMeas(Math.trunc(clockLast / (beatNum * beatClock)));
    } else {
      this.setRepeatMeas(0);
      this.setLastMeas(0);
    }

    return PxtnErr.OK;
  }

  // カウント用: master セクションのサイズを確認して 5 を返す（C++ 互換）
  ioRV5EventNum(desc: MemoryIo): number {
    const size = ioGetUint32LE(desc);
    if (size !== 15) return 0;
    if (desc.remain < 15) return 0;
    desc.seek(SEEK_CUR, 15);
    return 5;
  }

  // x4x 形式
  ioRX4x(desc: MemoryIo): PxtnErr {
    ioGetInt32LE(desc);
    const dataNum = ioGetUint16LE(desc);
    const rrr = ioGetUint16LE(desc);
    const eventNum = ioGetUint32LE(desc);
    if (dataNum === null || rrr === null || eventNum === null) return PxtnErr.DESC_R;

    if (dataNum !== 3) return PxtnErr.FMT_UNKNOWN;
    if (rrr) return PxtnErr.FMT_UNKNOWN;

    let beatClock = EVENTDEFAULT_BEATCLOCK;
    let beatNum = EVENTDEFAULT_BEATNUM;
    let beatTempo = EVENTDEFAULT_BEATTEMPO;
    let repeatClock = 0;
    let lastClock = 0;

    let absolute = 0;
    let e = 0;
    for (; e < eventNum; e++) {
      const status = dataReadV(desc);
      const clock = dataReadV(desc);
      const volume = dataReadV(desc);
      if (status === null || clock === null || volume === null) break;
      absolute += clock;
      const curClock = absolute;

      switch (status) {
        case EventKind.BEATCLOCK:
          beatClock = volume;
          if (curClock) return PxtnErr.DESC_BROKEN;
          break;
        case EventKind.BEATTEMPO:
          beatTempo = int32ToFloat(volume);
          if (curClock) return PxtnErr.DESC_BROKEN;
          break;
        case EventKind.BEATNUM:
          beatNum = volume;
          if (curClock) return PxtnErr.DESC_BROKEN;
          break;
        case EventKind.REPEAT:
          repeatClock = curClock;
          if (volume) return PxtnErr.DESC_BROKEN;
          break;
        case EventKind.LAST:
          lastClock = curClock;
          if (volume) return PxtnErr.DESC_BROKEN;
          break;
        default:
          return PxtnErr.FMT_UNKNOWN;
      }
    }
    if (e !== eventNum) return PxtnErr.DESC_BROKEN;

    this._beat_num = beatNum;
    this._beat_tempo = beatTempo;
    this._beat_clock = beatClock;

    if (beatNum * beatClock) {
      this.setRepeatMeas(Math.trunc(repeatClock / (beatNum * beatClock)));
      this.setLastMeas(Math.trunc(lastClock / (beatNum * beatClock)));
    } else {
      this.setRepeatMeas(0);
      this.setLastMeas(0);
    }

    return PxtnErr.OK;
  }

  ioRX4xEventNum(desc: MemoryIo): number {
    const size = ioGetUint32LE(desc);
    if (size === null) return 0;
    const dataNum = ioGetUint16LE(desc);
    const rrr = ioGetUint16LE(desc);
    const eventNum = ioGetUint32LE(desc);
    if (dataNum === null || rrr === null || eventNum === null) return 0;
    if (dataNum !== 3) return 0;
    void rrr;

    for (let e = 0; e < eventNum; e++) {
      const a = dataReadV(desc);
      const b = dataReadV(desc);
      const c = dataReadV(desc);
      if (a === null || b === null || c === null) return 0;
    }
    return eventNum;
  }
}