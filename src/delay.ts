// pxtnDelay 相当（ディレイエフェクト）

import { PxtnErr } from "./error.js";
import { PXTN_MAX_CHANNEL, PXTN_MAX_TUNE_GROUP_NUM } from "./constants.js";
import type { MemoryIo } from "./data.js";
import { ioGetFloatLE, ioGetUint16LE, ioPutFloatLE, ioPutUint16LE, ioGetInt32LE, ioPutInt32LE } from "./data.js";

export enum DelayUnit {
  Beat = 0,
  Meas,
  Second,
  NUM,
}

export class Delay {
  private _bPlayed = true;
  private _unit = DelayUnit.Beat;
  private _group = 0;
  private _rate = 33.0;
  private _freq = 3.0;

  private _smpNum = 0;
  private _offset = 0;
  private _bufs: Int32Array[] = [new Int32Array(0), new Int32Array(0)];
  private _rateS32 = 100;

  get unit(): DelayUnit {
    return this._unit;
  }
  get group(): number {
    return this._group;
  }
  get rate(): number {
    return this._rate;
  }
  get freq(): number {
    return this._freq;
  }
  get played(): boolean {
    return this._bPlayed;
  }

  set(unit: DelayUnit, freq: number, rate: number, group: number): void {
    this._unit = unit;
    this._group = group;
    this._rate = rate;
    this._freq = freq;
  }

  setPlayed(b: boolean): void {
    this._bPlayed = b;
  }
  switchPlayed(): boolean {
    this._bPlayed = !this._bPlayed;
    return this._bPlayed;
  }

  toneRelease(): void {
    this._bufs = [new Int32Array(0), new Int32Array(0)];
    this._smpNum = 0;
  }

  toneReady(beatNum: number, beatTempo: number, sps: number): PxtnErr {
    this.toneRelease();
    let res = PxtnErr.VOID;

    if (this._freq && this._rate) {
      this._offset = 0;
      this._rateS32 = Math.trunc(this._rate);

      switch (this._unit) {
        case DelayUnit.Beat:
          this._smpNum = Math.trunc(Math.fround(Math.fround(sps * 60) / beatTempo) / this._freq);
          break;
        case DelayUnit.Meas:
          this._smpNum = Math.trunc(Math.fround(Math.fround(Math.fround(sps * 60 * beatNum) / beatTempo)) / this._freq);
          break;
        case DelayUnit.Second:
          this._smpNum = Math.trunc(Math.fround(sps / this._freq));
          break;
      }

      this._bufs = [];
      for (let c = 0; c < PXTN_MAX_CHANNEL; c++) {
        if (this._smpNum <= 0) {
          this._bufs.push(new Int32Array(0));
        } else {
          try {
            this._bufs.push(new Int32Array(this._smpNum));
          } catch {
            res = PxtnErr.MEMORY;
            break;
          }
        }
      }
      if (res !== PxtnErr.VOID) {
        this.toneRelease();
        return res;
      }
    }

    return PxtnErr.OK;
  }

  toneSupple(ch: number, groupSmps: Int32Array): void {
    if (!this._smpNum) return;
    const rateS32 = this._rateS32;
    const a = Math.trunc(Math.imul(this._bufs[ch]![this._offset]!, rateS32) / 100);
    if (this._bPlayed) groupSmps[this._group]! += a;
    this._bufs[ch]![this._offset] = groupSmps[this._group]!;
  }

  toneIncrement(): void {
    if (!this._smpNum) return;
    if (++this._offset >= this._smpNum) this._offset = 0;
  }

  toneClear(): void {
    if (!this._smpNum) return;
    for (let i = 0; i < PXTN_MAX_CHANNEL; i++) this._bufs[i]!.fill(0);
  }

  // 12byte
  write(desc: MemoryIo): boolean {
    const size = 12;
    ioPutInt32LE(desc, size);
    ioPutUint16LE(desc, this._unit);
    ioPutUint16LE(desc, this._group);
    ioPutFloatLE(desc, this._rate);
    ioPutFloatLE(desc, this._freq);
    return true;
  }

  read(desc: MemoryIo): PxtnErr {
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    const unit = ioGetUint16LE(desc);
    const group = ioGetUint16LE(desc);
    const rate = ioGetFloatLE(desc);
    const freq = ioGetFloatLE(desc);
    if (unit === null || group === null || rate === null || freq === null) return PxtnErr.DESC_R;
    if (unit >= DelayUnit.NUM) return PxtnErr.FMT_UNKNOWN;

    this._unit = unit;
    this._freq = freq;
    this._rate = rate;
    this._group = group;

    if (this._group >= PXTN_MAX_TUNE_GROUP_NUM) this._group = 0;
    void size;

    return PxtnErr.OK;
  }
}