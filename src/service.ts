// pxtnService 相当（曲データ全体の管理と ptcop 読み書き）
// 注: Moo レンダラーは engine.ts で別途移植する（ここでは管理・IOのみ）

import { PxtnErr } from "./error.js";
import { MemoryIo, SEEK_CUR, SEEK_SET, ioGetBytes, ioGetInt32LE, ioGetU16LE, ioGetUint16LE, ioPutInt32LE, ioPutU16LE, ioPutU8, ioGetFloatLE, ioGetUint32LE } from "./data.js";
import { PxtnText } from "./text.js";
import { Master } from "./master.js";
import { Evelist } from "./evelist.js";
import { EventKind, EVENTDEFAULT_BASICKEY, EVENTDEFAULT_BEATCLOCK } from "./event.js";
import { Delay } from "./delay.js";
import { OverDrive } from "./overdrive.js";
import { Woice, WoiceType } from "./woice.js";
import { Unit } from "./unit.js";
import { NoiseBuilder } from "./noise-builder.js";
import {
  PXTN_BITPERSAMPLE,
  PXTN_MAX_TUNE_DELAY_STRUCT,
  PXTN_MAX_TUNE_GROUP_NUM,
  PXTN_MAX_TUNE_OVERDRIVE_STRUCT,
  PXTN_MAX_TUNE_UNIT_NAME,
  PXTN_MAX_TUNE_UNIT_STRUCT,
  PXTN_MAX_TUNE_WOICE_STRUCT,
  PXTN_MAX_TUNEWOICENAME,
  PXTN_CODESIZE,
  PXTN_VERSIONSIZE,
} from "./constants.js";

// フォーマットバージョンコード
const CODE_TUNE_X2X = "PTTUNE--20050608";
const CODE_TUNE_X3X = "PTTUNE--20060115";
const CODE_TUNE_X4X = "PTTUNE--20060930";
const CODE_TUNE_V5 = "PTTUNE--20071119";
const CODE_PROJ_X1X = "PTCOLLAGE-050227";
const CODE_PROJ_X2X = "PTCOLLAGE-050608";
const CODE_PROJ_X3X = "PTCOLLAGE-060115";
const CODE_PROJ_X4X = "PTCOLLAGE-060930";
const CODE_PROJ_V5 = "PTCOLLAGE-071119";

const CODE_X1X_PROJ = "PROJECT=";
const CODE_X1X_EVEN = "EVENT===";
const CODE_X1X_UNIT = "UNIT====";
const CODE_X1X_END = "END=====";
const CODE_X1X_PCM = "matePCM=";
const CODE_X3X_PXTNUNIT = "pxtnUNIT";
const CODE_X4X_EVENMAST = "evenMAST";
const CODE_X4X_EVENUNIT = "evenUNIT";
const CODE_ANTIOPER = "antiOPER";
const CODE_NUM_UNIT = "num UNIT";
const CODE_MASTERV5 = "MasterV5";
const CODE_EVENT_V5 = "Event V5";
const CODE_MATEPCM = "matePCM ";
const CODE_MATEPTV = "matePTV ";
const CODE_MATEPTN = "matePTN ";
const CODE_MATEOGGV = "mateOGGV";
const CODE_EFFEDELA = "effeDELA";
const CODE_EFFEOVER = "effeOVER";
const CODE_TEXTNAME = "textNAME";
const CODE_TEXTCOMM = "textCOMM";
const CODE_ASSIUNIT = "assiUNIT";
const CODE_ASSIWOIC = "assiWOIC";
const CODE_PXTONEND = "pxtoneND";

const enum Tag {
  Unknown = 0,
  AntiOper,
  X1xProj,
  X1xUnit,
  X1xPcm,
  X1xEven,
  X1xEnd,
  X3xPxtnUnit,
  X4xEvenMast,
  X4xEvenUnit,
  NumUnit,
  MasterV5,
  EventV5,
  MatePcm,
  MatePtv,
  MatePtn,
  MateOggv,
  EffeDela,
  EffeOver,
  TextName,
  TextComm,
  AssiUnit,
  AssiWoice,
  PxtoneNd,
}

const MAX_FMTVER_X1X_EVENTNUM = 10000;

enum FmtVer {
  Unknown = 0,
  X1x,
  X2x,
  X3x,
  X4x,
  V5,
}

function checkTagCode(code: string): Tag {
  switch (code) {
    case CODE_ANTIOPER:
      return Tag.AntiOper;
    case CODE_X1X_PROJ:
      return Tag.X1xProj;
    case CODE_X1X_UNIT:
      return Tag.X1xUnit;
    case CODE_X1X_PCM:
      return Tag.X1xPcm;
    case CODE_X1X_EVEN:
      return Tag.X1xEven;
    case CODE_X1X_END:
      return Tag.X1xEnd;
    case CODE_X3X_PXTNUNIT:
      return Tag.X3xPxtnUnit;
    case CODE_X4X_EVENMAST:
      return Tag.X4xEvenMast;
    case CODE_X4X_EVENUNIT:
      return Tag.X4xEvenUnit;
    case CODE_NUM_UNIT:
      return Tag.NumUnit;
    case CODE_EVENT_V5:
      return Tag.EventV5;
    case CODE_MASTERV5:
      return Tag.MasterV5;
    case CODE_MATEPCM:
      return Tag.MatePcm;
    case CODE_MATEPTV:
      return Tag.MatePtv;
    case CODE_MATEPTN:
      return Tag.MatePtn;
    case CODE_MATEOGGV:
      return Tag.MateOggv;
    case CODE_EFFEDELA:
      return Tag.EffeDela;
    case CODE_EFFEOVER:
      return Tag.EffeOver;
    case CODE_TEXTNAME:
      return Tag.TextName;
    case CODE_TEXTCOMM:
      return Tag.TextComm;
    case CODE_ASSIUNIT:
      return Tag.AssiUnit;
    case CODE_ASSIWOIC:
      return Tag.AssiWoice;
    case CODE_PXTONEND:
      return Tag.PxtoneNd;
    default:
      return Tag.Unknown;
  }
}

function asciiFromBytes(b: Uint8Array): string {
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

export class Service {
  text = new PxtnText();
  master = new Master();
  evels = new Evelist();

  private _bInit = false;
  private _bEdit = false;
  private _bFixEvelsNum = false;

  private _dstChNum = 2;
  private _dstSps = 44100;
  private _dstBytePerSmp = PXTN_BITPERSAMPLE / 8 * 2;

  private _ptnBldr: NoiseBuilder | null = null;

  private _delayMax = 0;
  private _delayNum = 0;
  private _delays: (Delay | null)[] = [];

  private _ovdrvMax = 0;
  private _ovdrvNum = 0;
  private _ovdrvs: (OverDrive | null)[] = [];

  private _woiceMax = 0;
  private _woiceNum = 0;
  private _woices: (Woice | null)[] = [];

  private _unitMax = 0;
  private _unitNum = 0;
  private _units: (Unit | null)[] = [];

  private _groupNum = PXTN_MAX_TUNE_GROUP_NUM;

  get isInit(): boolean {
    return this._bInit;
  }

  init(): PxtnErr {
    return this._init(0, false);
  }

  initCollage(fixEvelsNum: number): PxtnErr {
    return this._init(fixEvelsNum, true);
  }

  private _init(fixEvelsNum: number, bEdit: boolean): PxtnErr {
    if (this._bInit) return PxtnErr.INIT;
    this._ptnBldr = new NoiseBuilder();
    if (!this._ptnBldr.init()) return PxtnErr.PTN_INIT;

    if (fixEvelsNum) {
      this._bFixEvelsNum = true;
      if (!this.evels.allocate(fixEvelsNum)) return PxtnErr.MEMORY;
    } else {
      this._bFixEvelsNum = false;
    }

    this._delays = new Array(PXTN_MAX_TUNE_DELAY_STRUCT).fill(null);
    this._delayMax = PXTN_MAX_TUNE_DELAY_STRUCT;
    this._delayNum = 0;

    this._ovdrvs = new Array(PXTN_MAX_TUNE_OVERDRIVE_STRUCT).fill(null);
    this._ovdrvMax = PXTN_MAX_TUNE_OVERDRIVE_STRUCT;
    this._ovdrvNum = 0;

    this._woices = new Array(PXTN_MAX_TUNE_WOICE_STRUCT).fill(null);
    this._woiceMax = PXTN_MAX_TUNE_WOICE_STRUCT;
    this._woiceNum = 0;

    this._units = new Array(PXTN_MAX_TUNE_UNIT_STRUCT).fill(null);
    this._unitMax = PXTN_MAX_TUNE_UNIT_STRUCT;
    this._unitNum = 0;

    this._groupNum = PXTN_MAX_TUNE_GROUP_NUM;

    this._bEdit = bEdit;
    this._bInit = true;
    return PxtnErr.OK;
  }

  clear(): boolean {
    if (!this._bInit) return false;
    this.text.setNameBuf(new Uint8Array(0));
    this.text.setCommentBuf(new Uint8Array(0));
    this.evels.clear();
    this._delays.fill(null);
    this._delayNum = 0;
    this._ovdrvs.fill(null);
    this._ovdrvNum = 0;
    this._woices.fill(null);
    this._woiceNum = 0;
    this._units.fill(null);
    this._unitNum = 0;
    this.master.reset();
    if (!this._bEdit) this.evels.release();
    else this.evels.clear();
    return true;
  }

  adjustMeasNum(): boolean {
    if (!this._bInit) return false;
    this.master.adjustMeasNum(this.evels.maxClock);
    return true;
  }

  get groupNum(): number {
    return this._bInit ? this._groupNum : 0;
  }

  tonesReady(): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const beatNum = this.master.beatNum;
    const beatTempo = this.master.beatTempo;
    for (let i = 0; i < this._delayNum; i++) {
      const res = this._delays[i]!.toneReady(beatNum, beatTempo, this._dstSps);
      if (res !== PxtnErr.OK) return res;
    }
    for (let i = 0; i < this._ovdrvNum; i++) this._ovdrvs[i]!.toneReady();
    for (let i = 0; i < this._woiceNum; i++) {
      const res = this._woices[i]!.toneReady(this._ptnBldr, this._dstSps);
      if (res !== PxtnErr.OK) return res;
    }
    return PxtnErr.OK;
  }

  tonesClear(): boolean {
    if (!this._bInit) return false;
    for (let i = 0; i < this._delayNum; i++) this._delays[i]!.toneClear();
    for (let i = 0; i < this._unitNum; i++) this._units[i]!.toneClear();
    return true;
  }

  // Delay
  get delayNum(): number {
    return this._bInit ? this._delayNum : 0;
  }
  get delayMax(): number {
    return this._bInit ? this._delayMax : 0;
  }
  delaySet(idx: number, unit: number, freq: number, rate: number, group: number): boolean {
    if (!this._bInit) return false;
    if (idx >= this._delayNum) return false;
    this._delays[idx]!.set(unit, freq, rate, group);
    return true;
  }
  delayAdd(unit: number, freq: number, rate: number, group: number): boolean {
    if (!this._bInit) return false;
    if (this._delayNum >= this._delayMax) return false;
    const d = new Delay();
    d.set(unit, freq, rate, group);
    this._delays[this._delayNum] = d;
    this._delayNum++;
    return true;
  }
  delayRemove(idx: number): boolean {
    if (!this._bInit) return false;
    if (idx >= this._delayNum) return false;
    this._delays.splice(idx, 1);
    this._delays.push(null);
    this._delayNum--;
    return true;
  }
  delayGet(idx: number): Delay | null {
    if (!this._bInit) return null;
    if (idx < 0 || idx >= this._delayNum) return null;
    return this._delays[idx] ?? null;
  }
  delayReadyTone(idx: number): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (idx < 0 || idx >= this._delayNum) return PxtnErr.PARAM;
    return this._delays[idx]!.toneReady(this.master.beatNum, this.master.beatTempo, this._dstSps);
  }

  // OverDrive
  get overdriveNum(): number {
    return this._bInit ? this._ovdrvNum : 0;
  }
  get overdriveMax(): number {
    return this._bInit ? this._ovdrvMax : 0;
  }
  overdriveSet(idx: number, cut: number, amp: number, group: number): boolean {
    if (!this._bInit) return false;
    if (idx >= this._ovdrvNum) return false;
    this._ovdrvs[idx]!.set(cut, amp, group);
    return true;
  }
  overdriveAdd(cut: number, amp: number, group: number): boolean {
    if (!this._bInit) return false;
    if (this._ovdrvNum >= this._ovdrvMax) return false;
    const o = new OverDrive();
    o.set(cut, amp, group);
    this._ovdrvs[this._ovdrvNum] = o;
    this._ovdrvNum++;
    return true;
  }
  overdriveRemove(idx: number): boolean {
    if (!this._bInit) return false;
    if (idx >= this._ovdrvNum) return false;
    this._ovdrvs.splice(idx, 1);
    this._ovdrvs.push(null);
    this._ovdrvNum--;
    return true;
  }
  overdriveGet(idx: number): OverDrive | null {
    if (!this._bInit) return null;
    if (idx < 0 || idx >= this._ovdrvNum) return null;
    return this._ovdrvs[idx] ?? null;
  }
  overdriveReadyTone(idx: number): boolean {
    if (!this._bInit) return false;
    if (idx < 0 || idx >= this._ovdrvNum) return false;
    this._ovdrvs[idx]!.toneReady();
    return true;
  }

  // Woice
  get woiceNum(): number {
    return this._bInit ? this._woiceNum : 0;
  }
  get woiceMax(): number {
    return this._bInit ? this._woiceMax : 0;
  }
  woiceGet(idx: number): Woice | null {
    if (!this._bInit) return null;
    if (idx < 0 || idx >= this._woiceNum) return null;
    return this._woices[idx] ?? null;
  }
  woiceRead(idx: number, desc: MemoryIo, type: WoiceType): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (idx < 0 || idx >= this._woiceMax) return PxtnErr.PARAM;
    if (idx > this._woiceNum) return PxtnErr.PARAM;
    if (idx === this._woiceNum) {
      this._woices[idx] = new Woice();
      this._woiceNum++;
    }
    const res = this._woices[idx]!.read(desc, type);
    if (res !== PxtnErr.OK) {
      this.woiceRemove(idx);
      return res;
    }
    return res;
  }
  woiceReadyTone(idx: number): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (idx < 0 || idx >= this._woiceNum) return PxtnErr.PARAM;
    return this._woices[idx]!.toneReady(this._ptnBldr, this._dstSps);
  }
  woiceRemove(idx: number): boolean {
    if (!this._bInit) return false;
    if (idx < 0 || idx >= this._woiceNum) return false;
    this._woices.splice(idx, 1);
    this._woices.push(null);
    this._woiceNum--;
    return true;
  }
  woiceReplace(oldPlace: number, newPlace: number): boolean {
    if (!this._bInit) return false;
    const pW = this._woices[oldPlace];
    let maxPlace = this._woiceNum - 1;
    if (newPlace > maxPlace) newPlace = maxPlace;
    if (newPlace === oldPlace) return true;
    if (oldPlace < newPlace) {
      for (let w = oldPlace; w < newPlace; w++) {
        if (this._woices[w]) this._woices[w] = this._woices[w + 1] ?? null;
      }
    } else {
      for (let w = oldPlace; w > newPlace; w--) {
        if (this._woices[w]) this._woices[w] = this._woices[w - 1] ?? null;
      }
    }
    this._woices[newPlace] = pW ?? null;
    return true;
  }

  // Unit
  get unitNum(): number {
    return this._bInit ? this._unitNum : 0;
  }
  get unitMax(): number {
    return this._bInit ? this._unitMax : 0;
  }
  unitGet(idx: number): Unit | null {
    if (!this._bInit) return null;
    if (idx < 0 || idx >= this._unitNum) return null;
    return this._units[idx] ?? null;
  }
  unitAddNew(): boolean {
    if (this._unitNum >= this._unitMax) return false;
    this._units[this._unitNum] = new Unit();
    this._unitNum++;
    return true;
  }
  unitRemove(idx: number): boolean {
    if (!this._bInit) return false;
    if (idx < 0 || idx >= this._unitNum) return false;
    this._units.splice(idx, 1);
    this._units.push(null);
    this._unitNum--;
    return true;
  }
  unitReplace(oldPlace: number, newPlace: number): boolean {
    if (!this._bInit) return false;
    const pW = this._units[oldPlace];
    let maxPlace = this._unitNum - 1;
    if (newPlace > maxPlace) newPlace = maxPlace;
    if (newPlace === oldPlace) return true;
    if (oldPlace < newPlace) {
      for (let w = oldPlace; w < newPlace; w++) {
        if (this._units[w]) this._units[w] = this._units[w + 1] ?? null;
      }
    } else {
      for (let w = oldPlace; w > newPlace; w--) {
        if (this._units[w]) this._units[w] = this._units[w - 1] ?? null;
      }
    }
    this._units[newPlace] = pW ?? null;
    return true;
  }
  unitSetOperatedAll(b: boolean): boolean {
    if (!this._bInit) return false;
    for (let u = 0; u < this._unitNum; u++) {
      this._units[u]!.setOperated(b);
      if (b) this._units[u]!.setPlayed(true);
    }
    return true;
  }
  unitSolo(idx: number): boolean {
    if (!this._bInit) return false;
    for (let u = 0; u < this._unitNum; u++) {
      if (u === idx) this._units[u]!.setPlayed(true);
      else this._units[u]!.setPlayed(false);
    }
    return false;
  }

  // Quality
  setDestinationQuality(chNum: number, sps: number): boolean {
    if (!this._bInit) return false;
    if (chNum !== 1 && chNum !== 2) return false;
    this._dstChNum = chNum;
    this._dstSps = sps;
    this._dstBytePerSmp = (PXTN_BITPERSAMPLE / 8) * chNum;
    return true;
  }
  getDestinationQuality(): { chNum: number; sps: number } {
    return { chNum: this._dstChNum, sps: this._dstSps };
  }

  // ---------- read ----------

  private _readVersion(desc: MemoryIo, out: { fmt: FmtVer; exeVer: number }): PxtnErr {
    const version = ioGetBytes(desc, PXTN_VERSIONSIZE);
    if (version === null) return PxtnErr.DESC_R;
    const v = asciiFromBytes(version);

    if (v === CODE_PROJ_X1X) {
      out.fmt = FmtVer.X1x;
      out.exeVer = 0;
      return PxtnErr.OK;
    }
    if (v === CODE_PROJ_X2X) {
      out.fmt = FmtVer.X2x;
      out.exeVer = 0;
      return PxtnErr.OK;
    }
    if (v === CODE_PROJ_X3X) out.fmt = FmtVer.X3x;
    else if (v === CODE_PROJ_X4X) out.fmt = FmtVer.X4x;
    else if (v === CODE_PROJ_V5) out.fmt = FmtVer.V5;
    else if (v === CODE_TUNE_X2X) {
      out.fmt = FmtVer.X2x;
      out.exeVer = 0;
      return PxtnErr.OK;
    } else if (v === CODE_TUNE_X3X) out.fmt = FmtVer.X3x;
    else if (v === CODE_TUNE_X4X) out.fmt = FmtVer.X4x;
    else if (v === CODE_TUNE_V5) out.fmt = FmtVer.V5;
    else return PxtnErr.FMT_UNKNOWN;

    const exeVer = ioGetUint16LE(desc);
    const dummy = ioGetUint16LE(desc);
    if (exeVer === null || dummy === null) return PxtnErr.DESC_R;
    out.exeVer = exeVer;
    return PxtnErr.OK;
  }

  private _preCountEvent(desc: MemoryIo, pCount: { value: number }): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const fmtVer: { fmt: FmtVer; exeVer: number } = { fmt: FmtVer.Unknown, exeVer: 0 };
    let res = this._readVersion(desc, fmtVer);
    if (res !== PxtnErr.OK) return res;

    if (fmtVer.fmt === FmtVer.X1x) {
      pCount.value = MAX_FMTVER_X1X_EVENTNUM;
      return PxtnErr.OK;
    }

    let count = 0;
    let c = 0;
    let bEnd = false;
    while (!bEnd) {
      const code = ioGetBytes(desc, PXTN_CODESIZE);
      if (code === null) return PxtnErr.DESC_R;
      switch (checkTagCode(asciiFromBytes(code))) {
        case Tag.EventV5:
          count += this.evels.ioReadEventNum(desc);
          break;
        case Tag.MasterV5:
          count += this.master.ioRV5EventNum(desc);
          break;
        case Tag.X4xEvenMast:
          count += this.master.ioRX4xEventNum(desc);
          break;
        case Tag.X4xEvenUnit: {
          const n = this.evels.ioReadX4xEventNum(desc);
          if (typeof n !== "number") {
            res = n;
            return res;
          }
          count += n;
          break;
        }
        case Tag.PxtoneNd:
          bEnd = true;
          break;
        case Tag.X1xProj:
        case Tag.X1xUnit:
        case Tag.X1xPcm:
        case Tag.X1xEven:
        case Tag.X1xEnd:
          return PxtnErr.X1X_IGNORE;
        default: {
          const size = ioGetInt32LE(desc);
          if (size === null) return PxtnErr.DESC_R;
          if (!desc.seek(SEEK_CUR, size)) return PxtnErr.DESC_R;
          break;
        }
      }
    }

    if (fmtVer.fmt <= FmtVer.X3x) count += PXTN_MAX_TUNE_UNIT_STRUCT * 4;

    pCount.value = count;
    return PxtnErr.OK;
  }

  private _ioReadDelay(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (this._delayNum >= this._delayMax) return PxtnErr.FMT_UNKNOWN;
    const delay = new Delay();
    const res = delay.read(desc);
    if (res === PxtnErr.OK) {
      this._delays[this._delayNum] = delay;
      this._delayNum++;
    }
    return res;
  }

  private _ioReadOverDrive(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (this._ovdrvNum >= this._ovdrvMax) return PxtnErr.FMT_UNKNOWN;
    const ovdrv = new OverDrive();
    const res = ovdrv.read(desc);
    if (res === PxtnErr.OK) {
      this._ovdrvs[this._ovdrvNum] = ovdrv;
      this._ovdrvNum++;
    }
    return res;
  }

  private _ioReadWoice(desc: MemoryIo, type: WoiceType): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (this._woiceNum >= this._woiceMax) return PxtnErr.Woice_FULL;
    const woice = new Woice();
    let res: PxtnErr;
    switch (type) {
      case WoiceType.PCM:
        res = woice.ioMatePcmR(desc);
        break;
      case WoiceType.PTV:
        res = woice.ioMatePtvR(desc);
        break;
      case WoiceType.PTN:
        res = woice.ioMatePtnR(desc);
        break;
      case WoiceType.OGGV:
        res = PxtnErr.OGG_NO_SUPPORTED;
        break;
      default:
        res = PxtnErr.FMT_UNKNOWN;
        break;
    }
    if (res !== PxtnErr.OK) return res;
    this._woices[this._woiceNum] = woice;
    this._woiceNum++;
    return PxtnErr.OK;
  }

  private _ioReadOldUnit(desc: MemoryIo, ver: number): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    if (this._unitNum >= this._unitMax) return PxtnErr.FMT_UNKNOWN;
    const unit = new Unit();
    const groupOut = { value: 0 };
    let res: PxtnErr = PxtnErr.OK;
    switch (ver) {
      case 1:
        if (!unit.readV1x(desc, groupOut)) res = PxtnErr.FMT_UNKNOWN;
        break;
      case 3:
        res = unit.readV3x(desc, groupOut);
        break;
      default:
        res = PxtnErr.FMT_UNKNOWN;
        break;
    }
    if (res !== PxtnErr.OK) return res;
    if (groupOut.value >= this._groupNum) groupOut.value = this._groupNum - 1;
    this.evels.x4xReadAdd(0, this._unitNum, EventKind.GROUPNO, groupOut.value);
    this.evels.x4xReadNewKind();
    this.evels.x4xReadAdd(0, this._unitNum, EventKind.VOICENO, this._unitNum);
    this.evels.x4xReadNewKind();
    this._units[this._unitNum] = unit;
    this._unitNum++;
    return PxtnErr.OK;
  }

  private _ioAssiWoiceR(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 20) return PxtnErr.FMT_UNKNOWN; // u16 + u16 + 16
    const woiceIndex = ioGetU16LE(desc);
    const rrr = ioGetU16LE(desc);
    const name = ioGetBytes(desc, PXTN_MAX_TUNEWOICENAME);
    if (woiceIndex === null || rrr === null || name === null) return PxtnErr.DESC_R;
    if (rrr) return PxtnErr.FMT_UNKNOWN;
    if (woiceIndex >= this._woiceNum) return PxtnErr.FMT_UNKNOWN;
    if (!this._woices[woiceIndex]!.setNameBuf(name, PXTN_MAX_TUNEWOICENAME)) return PxtnErr.FATAL;
    return PxtnErr.OK;
  }

  private _ioAssiUnitR(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 20) return PxtnErr.FMT_UNKNOWN; // u16 + u16 + 16
    const unitIndex = ioGetU16LE(desc);
    const rrr = ioGetU16LE(desc);
    const name = ioGetBytes(desc, PXTN_MAX_TUNE_UNIT_NAME);
    if (unitIndex === null || rrr === null || name === null) return PxtnErr.DESC_R;
    if (rrr) return PxtnErr.FMT_UNKNOWN;
    if (unitIndex >= this._unitNum) return PxtnErr.FMT_UNKNOWN;
    if (!this._units[unitIndex]!.setNameBuf(name)) return PxtnErr.FATAL;
    return PxtnErr.OK;
  }

  private _ioUnitNumR(desc: MemoryIo, pNum: { value: number }): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 4) return PxtnErr.FMT_UNKNOWN;
    const num = ioGetU16LE(desc);
    const rrr = ioGetU16LE(desc);
    if (num === null || rrr === null) return PxtnErr.DESC_R;
    if (rrr) return PxtnErr.FMT_UNKNOWN;
    if (num > this._unitMax) return PxtnErr.FMT_NEW;
    if (num < 0) return PxtnErr.FMT_UNKNOWN;
    pNum.value = num;
    return PxtnErr.OK;
  }

  private _readTuneItems(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    let bEnd = false;
    while (!bEnd) {
      const code = ioGetBytes(desc, PXTN_CODESIZE);
      if (code === null) return PxtnErr.DESC_R;
      switch (checkTagCode(asciiFromBytes(code))) {
        case Tag.AntiOper:
          return PxtnErr.ANTI_OPERATION;
        case Tag.NumUnit: {
          const num = { value: 0 };
          const res = this._ioUnitNumR(desc, num);
          if (res !== PxtnErr.OK) return res;
          for (let i = 0; i < num.value; i++) this._units[i] = new Unit();
          this._unitNum = num.value;
          break;
        }
        case Tag.MasterV5: {
          const res = this.master.ioRV5(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.EventV5: {
          const res = this.evels.ioRead(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.MatePcm: {
          const res = this._ioReadWoice(desc, WoiceType.PCM);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.MatePtv: {
          const res = this._ioReadWoice(desc, WoiceType.PTV);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.MatePtn: {
          const res = this._ioReadWoice(desc, WoiceType.PTN);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.MateOggv:
          return PxtnErr.OGG_NO_SUPPORTED;
        case Tag.EffeDela: {
          const res = this._ioReadDelay(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.EffeOver: {
          const res = this._ioReadOverDrive(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.TextName:
          if (!this.text.nameR(desc)) return PxtnErr.DESC_R;
          break;
        case Tag.TextComm:
          if (!this.text.commentR(desc)) return PxtnErr.DESC_R;
          break;
        case Tag.AssiWoice: {
          const res = this._ioAssiWoiceR(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.AssiUnit: {
          const res = this._ioAssiUnitR(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.PxtoneNd:
          bEnd = true;
          break;
        case Tag.X4xEvenMast: {
          const res = this.master.ioRX4x(desc);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X4xEvenUnit: {
          const res = this.evels.ioUnitReadX4xEvent(desc, false, true);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X3xPxtnUnit: {
          const res = this._ioReadOldUnit(desc, 3);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X1xProj:
          if (!this._x1xProjectRead(desc)) return PxtnErr.DESC_R;
          break;
        case Tag.X1xUnit: {
          const res = this._ioReadOldUnit(desc, 1);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X1xPcm: {
          const res = this._ioReadWoice(desc, WoiceType.PCM);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X1xEven: {
          const res = this.evels.ioUnitReadX4xEvent(desc, true, false);
          if (res !== PxtnErr.OK) return res;
          break;
        }
        case Tag.X1xEnd:
          bEnd = true;
          break;
        default:
          return PxtnErr.FMT_UNKNOWN;
      }
    }
    return PxtnErr.OK;
  }

  read(desc: MemoryIo): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    let res: PxtnErr = PxtnErr.OK;
    const exeVer = { value: 0 };
    const fmtVer: { fmt: FmtVer; exeVer: number } = { fmt: FmtVer.Unknown, exeVer: 0 };
    const eventNum = { value: 0 };

    this.clear();

    res = this._preCountEvent(desc, eventNum);
    if (res !== PxtnErr.OK) return res;
    desc.seek(SEEK_SET, 0);

    if (this._bFixEvelsNum) {
      if (eventNum.value > this.evels.numMax) return PxtnErr.TOO_MUCH_EVENT;
    } else {
      if (!this.evels.allocate(eventNum.value)) return PxtnErr.MEMORY;
    }

    res = this._readVersion(desc, fmtVer);
    if (res !== PxtnErr.OK) return res;
    void exeVer;

    if (fmtVer.fmt >= FmtVer.V5) this.evels.linearStart();
    else this.evels.x4xReadStart();

    res = this._readTuneItems(desc);
    if (res !== PxtnErr.OK) return res;

    if (fmtVer.fmt >= FmtVer.V5) this.evels.linearEnd(true);

    if (fmtVer.fmt <= FmtVer.X3x) {
      if (!this._x3xTuningKeyEvent()) return PxtnErr.X3X_KEY;
      if (!this._x3xAddTuningEvent()) return PxtnErr.X3X_ADD_TUNING;
      this._x3xSetVoiceNames();
    }

    if (this._bEdit && this.master.beatClock !== EVENTDEFAULT_BEATCLOCK) return PxtnErr.DENY_BEATCLOCK;

    const clock1 = this.evels.maxClock;
    const clock2 = this.master.lastClock;
    if (clock1 > clock2) this.master.adjustMeasNum(clock1);
    else this.master.adjustMeasNum(clock2);

    return PxtnErr.OK;
  }

  private _x3xTuningKeyEvent(): boolean {
    if (!this._bInit) return false;
    if (this._unitNum > this._woiceNum) return false;
    for (let u = 0; u < this._unitNum; u++) {
      if (u >= this._woiceNum) return false;
      const changeValue = this._woices[u]!.x3xBasicKey - EVENTDEFAULT_BASICKEY;
      if (!this.evels.countByUnitKind(u, EventKind.KEY)) {
        this.evels.recordAddI(0, u, EventKind.KEY, 0x6000);
      }
      this.evels.recordValueChange(0, -1, u, EventKind.KEY, changeValue);
    }
    return true;
  }

  private _x3xAddTuningEvent(): boolean {
    if (!this._bInit) return false;
    if (this._unitNum > this._woiceNum) return false;
    for (let u = 0; u < this._unitNum; u++) {
      const tuning = this._woices[u]!.x3xTuning;
      if (tuning) this.evels.recordAddF(0, u, EventKind.TUNING, tuning);
    }
    return true;
  }

  private _x3xSetVoiceNames(): void {
    for (let i = 0; i < this._woiceNum; i++) {
      const name = `voice_${String(i).padStart(2, "0")}`;
      this._woices[i]!.setNameBuf(name, 8);
    }
  }

  // x1x project..(36byte)
  private _x1xProjectRead(desc: MemoryIo): boolean {
    if (!this._bInit) return false;
    const size = ioGetInt32LE(desc);
    if (size === null) return false;
    void size;
    const name = ioGetBytes(desc, 16);
    if (name === null) return false;
    const beatTempo = ioGetFloatLE(desc);
    const beatClock = ioGetU16LE(desc);
    const beatNum = ioGetU16LE(desc);
    if (beatTempo === null || beatClock === null || beatNum === null) return false;
    void ioGetU16LE(desc); // beat_note
    void ioGetU16LE(desc); // meas_num
    void ioGetU16LE(desc); // channel_num
    void ioGetU16LE(desc); // bps
    void ioGetUint32LE(desc); // sps

    let ns = 0;
    for (; ns < 16; ns++) {
      if (!name[ns]) break;
    }
    this.text.setNameBuf(name.subarray(0, ns));
    this.master.set(beatNum, beatTempo, beatClock);
    return true;
  }

  // ---------- write ----------

  write(desc: MemoryIo, bTune: boolean, exeVer: number): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const rough = bTune ? 10 : 1;
    const code = bTune ? CODE_TUNE_V5 : CODE_PROJ_V5;
    writeAscii(desc, code);
    ioPutU16LE(desc, exeVer);
    ioPutU16LE(desc, 0);

    writeAscii(desc, CODE_MASTERV5);
    if (!this.master.ioWV5(desc, rough)) return PxtnErr.DESC_W;

    writeAscii(desc, CODE_EVENT_V5);
    if (!this.evels.ioWrite(desc, rough)) return PxtnErr.DESC_W;

    if (this.text.hasName) {
      writeAscii(desc, CODE_TEXTNAME);
      if (!this.text.nameW(desc)) return PxtnErr.DESC_W;
    }
    if (this.text.hasComment) {
      writeAscii(desc, CODE_TEXTCOMM);
      if (!this.text.commentW(desc)) return PxtnErr.DESC_W;
    }

    for (let d = 0; d < this._delayNum; d++) {
      writeAscii(desc, CODE_EFFEDELA);
      if (!this._delays[d]!.write(desc)) return PxtnErr.DESC_W;
    }
    for (let o = 0; o < this._ovdrvNum; o++) {
      writeAscii(desc, CODE_EFFEOVER);
      if (!this._ovdrvs[o]!.write(desc)) return PxtnErr.DESC_W;
    }

    for (let w = 0; w < this._woiceNum; w++) {
      const pW = this._woices[w]!;
      switch (pW.type) {
        case WoiceType.PCM:
          writeAscii(desc, CODE_MATEPCM);
          if (!pW.ioMatePcmW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.PTV:
          writeAscii(desc, CODE_MATEPTV);
          if (!pW.ioMatePtvW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.PTN:
          writeAscii(desc, CODE_MATEPTN);
          if (!pW.ioMatePtnW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.OGGV:
          return PxtnErr.OGG_NO_SUPPORTED;
        default:
          return PxtnErr.INV_DATA;
      }
      if (!bTune && pW.isNameBuf()) {
        writeAscii(desc, CODE_ASSIWOIC);
        if (!this._ioAssiWoiceW(desc, w)) return PxtnErr.DESC_W;
      }
    }

    writeAscii(desc, CODE_NUM_UNIT);
    if (!this._ioUnitNumW(desc)) return PxtnErr.DESC_W;

    for (let u = 0; u < this._unitNum; u++) {
      if (!bTune && this._units[u]!.isNameBuf()) {
        writeAscii(desc, CODE_ASSIUNIT);
        if (!this._ioAssiUnitW(desc, u)) return PxtnErr.DESC_W;
      }
    }

    writeAscii(desc, CODE_PXTONEND);
    ioPutInt32LE(desc, 0);
    return PxtnErr.OK;
  }

  private _ioAssiWoiceW(desc: MemoryIo, idx: number): boolean {
    if (!this._bInit) return false;
    const name = this._woices[idx]!.getNameBuf();
    if (this._woices[idx]!.nameSize > PXTN_MAX_TUNEWOICENAME) return false;
    ioPutInt32LE(desc, 20);
    ioPutU16LE(desc, idx);
    ioPutU16LE(desc, 0);
    for (let i = 0; i < PXTN_MAX_TUNEWOICENAME; i++) {
      ioPutU8(desc, i < name.length ? name[i]! : 0);
    }
    return true;
  }

  private _ioAssiUnitW(desc: MemoryIo, idx: number): boolean {
    if (!this._bInit) return false;
    const name = this._units[idx]!.name;
    ioPutInt32LE(desc, 20);
    ioPutU16LE(desc, idx);
    ioPutU16LE(desc, 0);
    for (let i = 0; i < PXTN_MAX_TUNE_UNIT_NAME; i++) {
      ioPutU8(desc, i < name.length ? name.charCodeAt(i) : 0);
    }
    return true;
  }

  private _ioUnitNumW(desc: MemoryIo): boolean {
    if (!this._bInit) return false;
    ioPutInt32LE(desc, 4);
    ioPutU16LE(desc, this._unitNum);
    ioPutU16LE(desc, 0);
    return true;
  }
}

function writeAscii(desc: MemoryIo, s: string): void {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  desc.write(b, 1, b.length);
}
