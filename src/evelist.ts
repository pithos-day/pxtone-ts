// pxtnEvelist 相当：イベントの双方向リンクリスト
//
// C++ は固定配列スロット（_eves[i].kind==NULL が空き）で二重リンクを張る実装。
// ここも同じく配列 + prev/next インデックスで再現する。

import { PxtnErr } from "./error.js";
import { EventKind, eventKindIsTail, comparePriority, EVENTDEFAULT_BEATNUM, EVENTDEFAULT_BEATTEMPO, EVENTDEFAULT_BEATCLOCK } from "./event.js";
import type { MemoryIo } from "./data.js";
import {
  ioGetU16LE,
  ioGetUint32LE,
  ioGetU8,
  ioPutInt32LE,
  ioPutU8,
  dataCheckVSize,
  dataReadV,
  dataWriteV,
  floatToInt32Bits,
  ioGetInt32LE,
} from "./data.js";

export const EVENTDEFAULT_VOLUME = 104;
export const EVENTDEFAULT_VELOCITY = 104;
export const EVENTDEFAULT_PAN_VOLUME = 64;
export const EVENTDEFAULT_PAN_TIME = 64;
export const EVENTDEFAULT_PORTAMENT = 0;
export const EVENTDEFAULT_VOICENO = 0;
export const EVENTDEFAULT_GROUPNO = 0;
export const EVENTDEFAULT_KEY = 0x6000;
export const EVENTDEFAULT_TUNING = 1.0;

export interface EveRecord {
  kind: number;
  unitNo: number;
  value: number;
  clock: number;
  prev: number;
  next: number;
}

function defaultKindValue(kind: number): number {
  switch (kind) {
    case EventKind.KEY:
      return EVENTDEFAULT_KEY;
    case EventKind.PAN_VOLUME:
      return EVENTDEFAULT_PAN_VOLUME;
    case EventKind.VELOCITY:
      return EVENTDEFAULT_VELOCITY;
    case EventKind.VOLUME:
      return EVENTDEFAULT_VOLUME;
    case EventKind.PORTAMENT:
      return EVENTDEFAULT_PORTAMENT;
    case EventKind.BEATCLOCK:
      return EVENTDEFAULT_BEATCLOCK;
    case EventKind.BEATTEMPO:
      return EVENTDEFAULT_BEATTEMPO;
    case EventKind.BEATNUM:
      return EVENTDEFAULT_BEATNUM;
    case EventKind.VOICENO:
      return EVENTDEFAULT_VOICENO;
    case EventKind.GROUPNO:
      return EVENTDEFAULT_GROUPNO;
    case EventKind.TUNING:
      return floatToInt32Bits(EVENTDEFAULT_TUNING);
    case EventKind.PAN_TIME:
      return EVENTDEFAULT_PAN_TIME;
  }
  return 0;
}

function makeRecord(): EveRecord {
  return { kind: EventKind.NULL, unitNo: 0, value: 0, clock: 0, prev: -1, next: -1 };
}

export class Evelist {
  private _eves: EveRecord[] = [];
  private _start = -1;
  private _nextSlot = 0; // 線形読み込み時に次へ書き込むスロット index
  private _pX4xRec = -1; // x4x 読み込みの探索開始位置 (前回挿入したレコード)

  release(): void {
    this._eves = [];
    this._start = -1;
  }

  clear(): void {
    for (let i = 0; i < this._eves.length; i++) {
      this._eves[i] = makeRecord();
    }
    this._start = -1;
  }

  allocate(maxEventNum: number): boolean {
    this.release();
    if (maxEventNum <= 0) return false;
    this._eves = new Array<EveRecord>(maxEventNum);
    for (let i = 0; i < maxEventNum; i++) this._eves[i] = makeRecord();
    return true;
  }

  get numMax(): number {
    return this._eves.length;
  }

  get maxClock(): number {
    let max = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      const clock = eventKindIsTail(e.kind) ? e.clock + e.value : e.clock;
      if (clock > max) max = clock;
    }
    return max;
  }

  get count(): number {
    if (this._eves.length === 0 || this._start < 0) return 0;
    let n = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) n++;
    return n;
  }

  countByValue(kind: number, value: number): number {
    return this.countBy((e) => e.kind === kind && e.value === value);
  }

  countByUnit(unitNo: number): number {
    return this.countBy((e) => e.unitNo === unitNo);
  }

  countByUnitKind(unitNo: number, kind: number): number {
    return this.countBy((e) => e.unitNo === unitNo && e.kind === kind);
  }

  // 条件に一致するレコードを数える
  private countBy(pred: (e: EveRecord) => boolean): number {
    if (this._eves.length === 0) return 0;
    let n = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      if (pred(this._eves[p]!)) n++;
    }
    return n;
  }

  countByClockRange(clock1: number, clock2: number, unitNo: number): number {
    if (this._eves.length === 0) return 0;
    let p = this._start;
    for (; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.unitNo === unitNo) {
        if (e.clock >= clock1) break;
        if (eventKindIsTail(e.kind) && e.clock + e.value > clock1) break;
      }
    }
    let n = 0;
    for (; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      // [clock1, clock2) を数えるが、clock1 と同時刻のイベントは clock2 を過ぎていても範囲内に含める
      if (e.clock !== clock1 && e.clock >= clock2) break;
      if (e.unitNo === unitNo) n++;
    }
    return n;
  }

  getValue(clock: number, unitNo: number, kind: number): number {
    if (this._eves.length === 0) return 0;
    let val = defaultKindValue(kind);
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.clock > clock) break;
      if (e.unitNo === unitNo && e.kind === kind) val = e.value;
    }
    return val;
  }

  get records(): EveRecord[] {
    const out: EveRecord[] = [];
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) out.push(this._eves[p]!);
    return out;
  }

  private recSet(pRec: number, prev: number, next: number, clock: number, unitNo: number, kind: number, value: number): void {
    if (prev >= 0) this._eves[prev]!.next = pRec;
    else this._start = pRec;
    if (next >= 0) this._eves[next]!.prev = pRec;
    const e = this._eves[pRec]!;
    e.next = next;
    e.prev = prev;
    e.clock = clock;
    e.kind = kind;
    e.unitNo = unitNo;
    e.value = value;
  }

  private recCut(pRec: number): void {
    const e = this._eves[pRec]!;
    if (e.prev >= 0) this._eves[e.prev]!.next = e.next;
    else this._start = e.next;
    if (e.next >= 0) this._eves[e.next]!.prev = e.prev;
    e.kind = EventKind.NULL;
  }

  recordAddF(clock: number, unitNo: number, kind: number, valueF: number): boolean {
    const value = floatToInt32Bits(valueF);
    return this.recordAddI(clock, unitNo, kind, value);
  }

  recordAddI(clock: number, unitNo: number, kind: number, value: number): boolean {
    if (this._eves.length === 0) return false;

    let pNew = -1;
    for (let r = 0; r < this._eves.length; r++) {
      if (this._eves[r]!.kind === EventKind.NULL) {
        pNew = r;
        break;
      }
    }
    if (pNew < 0) return false;

    const [pPrev, pNext] = this.findInsertPosition(clock, unitNo, kind, -1);

    this.recSet(pNew, pPrev, pNext, clock, unitNo, kind, value);

    // cut prev tail
    if (eventKindIsTail(kind)) {
      for (let p = this._eves[pNew]!.prev; p >= 0; p = this._eves[p]!.prev) {
        const e = this._eves[p]!;
        if (e.unitNo === unitNo && e.kind === kind) {
          if (clock < e.clock + e.value) e.value = clock - e.clock;
          break;
        }
      }
    }

    // delete next（自分より後ろで重なる tail イベントを消す）
    if (eventKindIsTail(kind)) {
      const limit = clock + value;
      for (let p = this._eves[pNew]!.next; p >= 0 && this._eves[p]!.clock < limit; p = this._eves[p]!.next) {
        const e = this._eves[p]!;
        if (e.unitNo === unitNo && e.kind === kind) this.recCut(p);
      }
    }

    return true;
  }

  // 挿入位置の直前/直後のレコード index (pPrev, pNext) を返す。
  // searchStart を指定するとそこから探索を始める (x4x 読み込みの最適化)
  private findInsertPosition(clock: number, unitNo: number, kind: number, searchStart: number): [number, number] {
    let pPrev = -1;
    let pNext = -1;
    if (this._start >= 0) {
      if (clock < this._eves[this._start]!.clock) {
        pNext = this._start;
      } else {
        let p = searchStart >= 0 ? searchStart : this._start;
        while (p >= 0) {
          const e = this._eves[p]!;
          if (e.clock === clock) {
            // 同時刻のレコード群の中から挿入位置を決める
            let p2 = p;
            while (p2 >= 0) {
              const e2 = this._eves[p2]!;
              if (e2.clock !== clock) {
                pPrev = e2.prev;
                pNext = p2;
                break;
              }
              if (unitNo === e2.unitNo && kind === e2.kind) {
                // 同じ unitNo/kind の既存イベントは NULL 化して置換する
                pPrev = e2.prev;
                pNext = e2.next;
                e2.kind = EventKind.NULL;
                break;
              }
              if (comparePriority(kind, e2.kind) < 0) {
                pPrev = e2.prev;
                pNext = p2;
                break;
              }
              if (e2.next < 0) {
                pPrev = p2;
                break;
              }
              p2 = e2.next;
            }
            break;
          } else if (e.clock > clock) {
            pPrev = e.prev;
            pNext = p;
            break;
          } else if (e.next < 0) {
            pPrev = p;
            break;
          }
          p = e.next;
        }
      }
    }
    return [pPrev, pNext];
  }

  recordDelete(clock1: number, clock2: number, unitNo: number, kind: number): number {
    return this.deleteInRange(clock1, clock2, unitNo, (k) => k === kind);
  }

  recordDeleteByUnit(clock1: number, clock2: number, unitNo: number): number {
    return this.deleteInRange(clock1, clock2, unitNo, () => true);
  }

  // [clock1, clock2) の範囲から条件に一致するレコードを削除する。
  // clock1 より前にある tail イベントは clock1 で切り詰める。
  private deleteInRange(clock1: number, clock2: number, unitNo: number, matchKind: (kind: number) => boolean): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      // clock1 と同時刻のイベントは clock2 を過ぎていても範囲内に含める
      if (e.clock !== clock1 && e.clock >= clock2) break;
      if (e.clock >= clock1 && e.unitNo === unitNo && matchKind(e.kind)) {
        this.recCut(p);
        count++;
      }
    }
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.clock >= clock1) break;
      if (e.unitNo === unitNo && matchKind(e.kind) && eventKindIsTail(e.kind) && e.clock + e.value > clock1) {
        e.value = clock1 - e.clock;
        count++;
      }
    }
    return count;
  }

  recordUnitNoMiss(unitNo: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.unitNo === unitNo) {
        this.recCut(p);
        count++;
      } else if (e.unitNo > unitNo) {
        e.unitNo--;
        count++;
      }
    }
    return count;
  }

  recordUnitNoSet(unitNo: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      this._eves[p]!.unitNo = unitNo;
      count++;
    }
    return count;
  }

  recordUnitNoReplace(oldU: number, newU: number): number {
    return this.replaceShifting(() => true, (e) => e.unitNo, (e, v) => (e.unitNo = v), oldU, newU);
  }

  recordValueSet(clock1: number, clock2: number, unitNo: number, kind: number, value: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.unitNo === unitNo && e.kind === kind && e.clock >= clock1 && e.clock < clock2) {
        e.value = value;
        count++;
      }
    }
    return count;
  }

  beatClockOperation(rate: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      e.clock *= rate;
      if (eventKindIsTail(e.kind)) e.value *= rate;
      count++;
    }
    return count;
  }

  recordValueChange(clock1: number, clock2: number, unitNo: number, kind: number, value: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    // イベント種別ごとの値の範囲。ON は長さ (120 クロック)、KEY は音高、その他は音量系 (0x80)
    let max: number;
    let min: number;
    switch (kind) {
      case EventKind.NULL:
        max = 0;
        min = 0;
        break;
      case EventKind.ON:
        max = 120;
        min = 120;
        break;
      case EventKind.KEY:
        max = 0xbfff;
        min = 0;
        break;
      case EventKind.PAN_VOLUME:
      case EventKind.PAN_TIME:
      case EventKind.VELOCITY:
      case EventKind.VOLUME:
        max = 0x80;
        min = 0;
        break;
      default:
        max = 0;
        min = 0;
    }
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.unitNo === unitNo && e.kind === kind && e.clock >= clock1) {
        if (clock2 === -1 || e.clock < clock2) {
          e.value += value;
          if (e.value < min) e.value = min;
          if (e.value > max) e.value = max;
          count++;
        }
      }
    }
    return count;
  }

  recordValueOmit(kind: number, value: number): number {
    if (this._eves.length === 0) return 0;
    let count = 0;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (e.kind === kind) {
        if (e.value === value) {
          this.recCut(p);
          count++;
        } else if (e.value > value) {
          e.value--;
          count++;
        }
      }
    }
    return count;
  }

  recordValueReplace(kind: number, oldValue: number, newValue: number): number {
    return this.replaceShifting((k) => k === kind, (e) => e.value, (e, v) => (e.value = v), oldValue, newValue);
  }

  // 値 oldValue を newValue に置換し、両者の間にある値は oldValue の方向へ 1 ずつシフトする。
  // (例: 値 2→4 の置換は、3 と 4 を 2 と 3 へ繰り下げる)
  private replaceShifting(
    matchKind: (kind: number) => boolean,
    get: (e: EveRecord) => number,
    set: (e: EveRecord, v: number) => void,
    oldValue: number,
    newValue: number,
  ): number {
    if (this._eves.length === 0) return 0;
    if (oldValue === newValue) return 0;
    let count = 0;
    const shift = oldValue < newValue ? -1 : 1;
    for (let p = this._start; p >= 0; p = this._eves[p]!.next) {
      const e = this._eves[p]!;
      if (!matchKind(e.kind)) continue;
      const v = get(e);
      if (v === oldValue) {
        set(e, newValue);
        count++;
      } else if (shift === -1 ? v > oldValue && v <= newValue : v < oldValue && v >= newValue) {
        set(e, v + shift);
        count++;
      }
    }
    return count;
  }

  recordClockShift(clock: number, shift: number, unitNo: number): number {
    if (this._eves.length === 0) return 0;
    if (this._start < 0) return 0;
    if (!shift) return 0;
    let count = 0;

    if (shift < 0) {
      let p = this._start;
      for (; p >= 0; p = this._eves[p]!.next) {
        if (this._eves[p]!.clock >= clock) break;
      }
      while (p >= 0) {
        if (this._eves[p]!.unitNo === unitNo) {
          const shiftedClock = this._eves[p]!.clock + shift;
          const kind = this._eves[p]!.kind;
          const value = this._eves[p]!.value;
          const pNext = this._eves[p]!.next;
          this.recCut(p);
          if (shiftedClock >= 0) this.recordAddI(shiftedClock, unitNo, kind, value);
          count++;
          p = pNext;
        } else {
          p = this._eves[p]!.next;
        }
      }
    } else {
      // shift > 0 (先頭の `if (!shift) return 0` で shift === 0 は除外済み)
      let p = this._start;
      while (this._eves[p]!.next >= 0) p = this._eves[p]!.next;
      while (p >= 0) {
        if (this._eves[p]!.clock < clock) break;
        if (this._eves[p]!.unitNo === unitNo) {
          const shiftedClock = this._eves[p]!.clock + shift;
          const kind = this._eves[p]!.kind;
          const value = this._eves[p]!.value;
          const pPrev = this._eves[p]!.prev;
          this.recCut(p);
          this.recordAddI(shiftedClock, unitNo, kind, value);
          count++;
          p = pPrev;
        } else {
          p = this._eves[p]!.prev;
        }
      }
    }
    return count;
  }

  // 読み込みモード開始: スロットを初期化して先頭から書き込めるようにする
  private beginRead(): boolean {
    if (this._eves.length === 0) return false;
    this.clear();
    this._nextSlot = 0;
    return true;
  }

  // linear 読み込みモード
  linearStart(): boolean {
    return this.beginRead();
  }

  linearAddI(clock: number, unitNo: number, kind: number, value: number): void {
    const e = this._eves[this._nextSlot]!;
    e.clock = clock;
    e.unitNo = unitNo;
    e.kind = kind;
    e.value = value;
    this._nextSlot++;
  }

  linearAddF(clock: number, unitNo: number, kind: number, valueF: number): void {
    const value = floatToInt32Bits(valueF);
    this.linearAddI(clock, unitNo, kind, value);
  }

  linearEnd(connect: boolean): void {
    if (this._eves.length > 0 && this._eves[0]!.kind !== EventKind.NULL) this._start = 0;
    if (connect) {
      for (let r = 1; r < this._eves.length; r++) {
        if (this._eves[r]!.kind === EventKind.NULL) break;
        this._eves[r]!.prev = r - 1;
        this._eves[r - 1]!.next = r;
      }
    }
  }

  // x4x 読み込み
  x4xReadStart(): boolean {
    if (!this.beginRead()) return false;
    this._pX4xRec = -1;
    return true;
  }

  x4xReadNewKind(): void {
    this._pX4xRec = -1;
  }

  x4xReadAdd(clock: number, unitNo: number, kind: number, value: number): void {
    const pNew = this._nextSlot++;
    const [pPrev, pNext] = this.findInsertPosition(clock, unitNo, kind, this._pX4xRec);
    this.recSet(pNew, pPrev, pNext, clock, unitNo, kind, value);
    this._pX4xRec = pNew;
  }

  // ---- io ----

  ioWrite(desc: MemoryIo, quantizeBits: number): boolean {
    const eveNum = this.count;
    let relativeSize = 0;

    for (const p of this.records) {
      relativeSize += dataCheckVSize(p.clock);
      relativeSize += 1;
      relativeSize += 1;
      relativeSize += dataCheckVSize(p.value);
    }

    const size = 4 + relativeSize;
    ioPutInt32LE(desc, size);
    ioPutInt32LE(desc, eveNum);

    let absolute = 0;
    for (const p of this.records) {
      const clock = p.clock - absolute;
      const value = eventKindIsTail(p.kind) ? Math.trunc(p.value / quantizeBits) : p.value;
      dataWriteV(desc, Math.trunc(clock / quantizeBits));
      ioPutU8(desc, p.unitNo);
      ioPutU8(desc, p.kind);
      dataWriteV(desc, value);
      absolute = p.clock;
    }
    return true;
  }

  ioRead(desc: MemoryIo): PxtnErr {
    const size = ioGetInt32LE(desc);
    const eveNum = ioGetInt32LE(desc);
    if (size === null || eveNum === null) return PxtnErr.DESC_R;
    void size;

    // 各イベントの clock は前のイベントからの差分で格納されている
    let absolute = 0;

    for (let e = 0; e < eveNum; e++) {
      const rv = dataReadV(desc);
      const unitNo = ioGetU8(desc);
      const kind = ioGetU8(desc);
      const value = dataReadV(desc);
      if (rv === null || unitNo === null || kind === null || value === null) return PxtnErr.DESC_R;
      absolute += rv;
      this.linearAddI(absolute, unitNo, kind, value);
    }
    return PxtnErr.OK;
  }

  ioReadEventNum(desc: MemoryIo): number {
    const size = ioGetInt32LE(desc);
    const eveNum = ioGetInt32LE(desc);
    if (size === null || eveNum === null) return 0;

    for (let e = 0; e < eveNum; e++) {
      const clock = dataReadV(desc);
      const unitNo = ioGetU8(desc);
      const kind = ioGetU8(desc);
      const value = dataReadV(desc);
      if (clock === null || unitNo === null || kind === null || value === null) return 0;
    }
    return eveNum;
  }

  // _x4x_EVENTSTRUCT: unit_index / event_kind / data_num / rrr / event_num (12byte)
  ioUnitReadX4xEvent(desc: MemoryIo, bTailAbsolute: boolean, bCheckRRR: boolean): PxtnErr {
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    const unitIndex = ioGetU16LE(desc);
    const eventKind = ioGetU16LE(desc);
    const dataNum = ioGetU16LE(desc);
    const rrr = ioGetU16LE(desc);
    const eventNum = ioGetUint32LE(desc);
    if (unitIndex === null || eventKind === null || dataNum === null || rrr === null || eventNum === null) {
      return PxtnErr.DESC_R;
    }
    if (dataNum !== 2) return PxtnErr.FMT_UNKNOWN;
    if (eventKind >= EventKind.NUM) return PxtnErr.FMT_UNKNOWN;
    if (bCheckRRR && rrr) return PxtnErr.FMT_UNKNOWN;
    void size;

    let absolute = 0;
    let clock = 0;
    let value = 0;
    let e = 0;
    for (; e < eventNum; e++) {
      const cv = dataReadV(desc);
      const vv = dataReadV(desc);
      if (cv === null || vv === null) break;
      clock = cv;
      value = vv;
      absolute += clock;
      clock = absolute;
      this.x4xReadAdd(clock, unitIndex, eventKind, value);
      if (bTailAbsolute && eventKindIsTail(eventKind)) absolute += value;
    }
    if (e !== eventNum) return PxtnErr.DESC_BROKEN;

    this.x4xReadNewKind();
    return PxtnErr.OK;
  }

  ioReadX4xEventNum(desc: MemoryIo): PxtnErr | number {
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    const unitIndex = ioGetU16LE(desc);
    const eventKind = ioGetU16LE(desc);
    const dataNum = ioGetU16LE(desc);
    const reserved = ioGetU16LE(desc);
    const eventNum = ioGetUint32LE(desc);
    if (unitIndex === null || eventKind === null || dataNum === null || reserved === null || eventNum === null) {
      return PxtnErr.DESC_R;
    }
    void size;

    if (dataNum !== 2) return PxtnErr.FMT_UNKNOWN;

    let e = 0;
    for (; e < eventNum; e++) {
      const clock = dataReadV(desc);
      const value = dataReadV(desc);
      if (clock === null || value === null) break;
    }
    if (e !== eventNum) return PxtnErr.DESC_BROKEN;
    return eventNum;
  }
}