// pxtnOverDrive 相当（クリッパー/ドライブ）

import { PxtnErr } from "./error.js";
import type { MemoryIo } from "./data.js";
import { ioGetFloatLE, ioGetUint16LE, ioPutFloatLE, ioPutUint16LE, ioGetInt32LE, ioPutInt32LE } from "./data.js";
import { f32Div } from "./float32.js";

export const TUNEOVERDRIVE_CUT_MAX = 99.9;
export const TUNEOVERDRIVE_CUT_MIN = 50.0;
export const TUNEOVERDRIVE_AMP_MAX = 8.0;
export const TUNEOVERDRIVE_AMP_MIN = 0.1;
export const TUNEOVERDRIVE_DEFAULT_CUT = 90.0;
export const TUNEOVERDRIVE_DEFAULT_AMP = 2.0;

export class OverDrive {
  private _bPlayed = true;
  private _group = 0;
  private _cutF = 0;
  private _ampF = 0;
  private _cut16bitTop = 0;

  get cut(): number {
    return this._cutF;
  }
  get amp(): number {
    return this._ampF;
  }
  get group(): number {
    return this._group;
  }
  get played(): boolean {
    return this._bPlayed;
  }

  set(cut: number, amp: number, group: number): void {
    this._cutF = cut;
    this._ampF = amp;
    this._group = group;
  }

  setPlayed(b: boolean): void {
    this._bPlayed = b;
  }
  switchPlayed(): boolean {
    this._bPlayed = !this._bPlayed;
    return this._bPlayed;
  }

  toneReady(): void {
    // クリップ閾値: cut (50..99.9%) を int16 範囲に換算する (C++ の float 演算を再現)
    this._cut16bitTop = Math.trunc(f32Div(32767 * (100 - this._cutF), 100));
  }

  toneSupple(groupSmps: Int32Array): void {
    if (!this._bPlayed) return;
    let work = groupSmps[this._group]!;
    const top = this._cut16bitTop;
    if (work > top) work = top;
    else if (work < -top) work = -top;
    groupSmps[this._group] = Math.trunc(Math.fround(work * this._ampF));
  }

  // 16byte
  write(desc: MemoryIo): boolean {
    const size = 16;
    ioPutInt32LE(desc, size);
    ioPutUint16LE(desc, 0); // reserved
    ioPutUint16LE(desc, this._group);
    ioPutFloatLE(desc, this._cutF);
    ioPutFloatLE(desc, this._ampF);
    ioPutFloatLE(desc, 0); // reserved
    return true;
  }

  read(desc: MemoryIo): PxtnErr {
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    const reserved1 = ioGetUint16LE(desc);
    const group = ioGetUint16LE(desc);
    const cut = ioGetFloatLE(desc);
    const amp = ioGetFloatLE(desc);
    const reserved2 = ioGetFloatLE(desc);
    if (reserved1 === null || group === null || cut === null || amp === null || reserved2 === null) return PxtnErr.DESC_R;

    if (reserved1) return PxtnErr.FMT_UNKNOWN;
    if (reserved2) return PxtnErr.FMT_UNKNOWN;
    if (cut > TUNEOVERDRIVE_CUT_MAX || cut < TUNEOVERDRIVE_CUT_MIN) return PxtnErr.FMT_UNKNOWN;
    if (amp > TUNEOVERDRIVE_AMP_MAX || amp < TUNEOVERDRIVE_AMP_MIN) return PxtnErr.FMT_UNKNOWN;

    this._cutF = cut;
    this._ampF = amp;
    this._group = group;
    void size;

    return PxtnErr.OK;
  }
}