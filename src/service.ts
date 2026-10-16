// pxtnService 相当（曲データ全体の管理と ptcop 読み書き）
// 注: Moo レンダラーは engine.ts で別途移植する（ここでは管理・IOのみ）

import { PxtnErr } from "./error.js";
import type { OggvDecoder } from "./oggv.js";
import { MemoryIo, SEEK_CUR, SEEK_SET, ioGetBytes, ioGetInt32LE, ioGetU16LE, ioGetUint16LE, ioGetUint32LE, ioPutAsciiString, ioPutInt32LE, ioPutU16LE, ioPutU8, ioGetFloatLE, int32ToFloat } from "./data.js";
import { PxtnText } from "./text.js";
import { Master } from "./master.js";
import { Evelist, type EveRecord } from "./evelist.js";
import { EventKind, EVENTDEFAULT_BASICKEY, EVENTDEFAULT_BEATCLOCK, EVENTDEFAULT_KEY, EVENTDEFAULT_VOICENO } from "./event.js";
import { Delay } from "./delay.js";
import { OverDrive } from "./overdrive.js";
import { Woice, WoiceType, PTV_VOICEFLAG_BEATFIT } from "./woice.js";
import { Unit } from "./unit.js";
import { NoiseBuilder } from "./noise-builder.js";
import { Frequency } from "./frequency.js";
import {
  CLOCK_ROUGH,
  PXTN_BASIC_SPS,
  PXTN_BITPERSAMPLE,
  PXTN_BUFSIZE_TIMEPAN,
  PXTN_MAX_CHANNEL,
  PXTN_MAX_TUNE_DELAY_STRUCT,
  PXTN_MAX_TUNE_GROUP_NUM,
  PXTN_MAX_TUNE_OVERDRIVE_STRUCT,
  PXTN_MAX_TUNE_UNIT_NAME,
  PXTN_MAX_TUNE_UNIT_STRUCT,
  PXTN_MAX_TUNE_WOICE_STRUCT,
  PXTN_MAX_TUNEWOICENAME,
  PXTN_CODESIZE,
  PXTN_VERSIONSIZE,
  PXTN_VOMIT_PREP_FLAG_LOOP,
  PXTN_VOMIT_PREP_FLAG_UNIT_MUTE,
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
  private _dstSps = PXTN_BASIC_SPS;
  // 1 サンプル分のバイト数 (2ch × 16bit)
  private _dstBytePerSmp = (PXTN_BITPERSAMPLE / 8) * PXTN_MAX_CHANNEL;

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

  // ---- Moo (レンダラー) 状態 ----
  // * レンダリング設定
  private _mooBValidData = false;
  private _mooBEndVomit = true; // レンダリング終了 (サンプルを生成できない状態)
  private _mooBMuteByUnit = false;
  private _mooBLoop = true;
  private _mooFadeDir = 0; // フェード方向 (-1: out / 0: なし / 1: in)
  private _mooMasterVol = 1.0;
  private _mooClockRate = 0; // 1 クロックあたりのサンプル数
  private _mooSmpStride = 1; // 再生ピッチ (clockRate 基準の倍率)
  private _mooTop = 0x7fff; // 出力クリップ上限 (int16)
  // * ビート (マスターテンポ由来)
  private _mooBtClock = 0;
  private _mooBtNum = 0;
  private _mooBtTempo = 0;
  // * フェード状態 (count/max は 8bit 固定小数。mooSetFade 参照)
  private _mooFadeCount = 0;
  private _mooFadeMax = 0;
  // * サンプル位置 (クロック単位は _mooClockRate で換算)
  private _mooSmpCount = 0;
  private _mooSmpStart = 0;
  private _mooSmpEnd = 0;
  private _mooSmpRepeat = 0;
  private _mooSmpSmooth = 0;
  private _mooTimePanIndex = 0; // パン用リングバッファの書き込み位置
  // * イベント再生
  private _mooFreq: Frequency | null = null;
  private _mooGroupSmps: Int32Array | null = null;
  private _mooPEve = -1; // 次に処理する _mooRecords の index
  private _mooRecords: EveRecord[] = [];

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

    if (!this._mooInit()) return PxtnErr.MOO_INIT;

    this._bEdit = bEdit;
    this._bInit = true;
    return PxtnErr.OK;
  }

  private _mooInit(): boolean {
    this._mooFreq = new Frequency();
    this._mooFreq.init();
    this._mooGroupSmps = new Int32Array(this._groupNum);
    return true;
  }

  clear(): boolean {
    if (!this._bInit) return false;
    if (!this._bEdit) this._mooBValidData = false;
    this.text.setNameBuf(new Uint8Array(0));
    this.text.setCommentBuf(new Uint8Array(0));
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
      // OGGV ボイスは decodeOggvAll() で事前に PCM 化する必要がある
      if (this._woices[i]!.type === WoiceType.OGGV && !this._woices[i]!.isOggvDecoded()) {
        return PxtnErr.OGG_NO_SUPPORTED;
      }
      const res = this._woices[i]!.toneReady(this._ptnBldr, this._dstSps);
      if (res !== PxtnErr.OK) return res;
    }
    return PxtnErr.OK;
  }

  // 全 OGGV ボイスをデコードして PCM 化する (async)
  async decodeOggvAll(decoder: OggvDecoder): Promise<PxtnErr> {
    if (!this._bInit) return PxtnErr.INIT;
    for (let i = 0; i < this._woiceNum; i++) {
      const w = this._woices[i]!;
      if (w.type !== WoiceType.OGGV) continue;
      const res = await w.decodeOggv(decoder);
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
  delaySet(idx: number, unitNo: number, freq: number, rate: number, groupNo: number): boolean {
    if (!this._bInit) return false;
    if (idx >= this._delayNum) return false;
    this._delays[idx]!.set(unitNo, freq, rate, groupNo);
    return true;
  }
  delayAdd(unitNo: number, freq: number, rate: number, groupNo: number): boolean {
    if (!this._bInit) return false;
    if (this._delayNum >= this._delayMax) return false;
    const d = new Delay();
    d.set(unitNo, freq, rate, groupNo);
    this._delays[this._delayNum] = d;
    this._delayNum++;
    return true;
  }
  delayRemove(idx: number): boolean {
    if (!this.removeAt(this._delays, idx, this._delayNum)) return false;
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
    if (!this.removeAt(this._ovdrvs, idx, this._ovdrvNum)) return false;
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
    if (!this.removeAt(this._woices, idx, this._woiceNum)) return false;
    this._woiceNum--;
    return true;
  }
  woiceReplace(oldPlace: number, newPlace: number): boolean {
    return this.replaceIn(this._woices, oldPlace, newPlace, this._woiceNum);
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
    if (!this.removeAt(this._units, idx, this._unitNum)) return false;
    this._unitNum--;
    return true;
  }
  unitReplace(oldPlace: number, newPlace: number): boolean {
    return this.replaceIn(this._units, oldPlace, newPlace, this._unitNum);
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
    // 常に false を返す (C++ 移植時の仕様。boolean 戻り値は互換のためのもの)
    return false;
  }

  // 固定サイズ配列の再現: 要素を削除して末尾を null で埋める
  private removeAt<T>(list: (T | null)[], idx: number, num: number): boolean {
    if (!this._bInit) return false;
    if (idx < 0 || idx >= num) return false;
    list.splice(idx, 1);
    list.push(null);
    return true;
  }

  // 要素を oldPlace から newPlace へ移動する (間の要素はシフト)
  private replaceIn<T>(list: (T | null)[], oldPlace: number, newPlace: number, num: number): boolean {
    if (!this._bInit) return false;
    const item = list[oldPlace];
    let maxPlace = num - 1;
    if (newPlace > maxPlace) newPlace = maxPlace;
    if (newPlace === oldPlace) return true;
    if (oldPlace < newPlace) {
      for (let w = oldPlace; w < newPlace; w++) {
        if (list[w]) list[w] = list[w + 1] ?? null;
      }
    } else {
      for (let w = oldPlace; w > newPlace; w--) {
        if (list[w]) list[w] = list[w - 1] ?? null;
      }
    }
    list[newPlace] = item ?? null;
    return true;
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
    const reserved = ioGetUint16LE(desc);
    if (exeVer === null || reserved === null) return PxtnErr.DESC_R;
    out.exeVer = exeVer;
    return PxtnErr.OK;
  }

  private _preCountEvent(desc: MemoryIo, pCount: { value: number }): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const fmtVer: { fmt: FmtVer; exeVer: number } = { fmt: FmtVer.Unknown, exeVer: 0 };
    const res = this._readVersion(desc, fmtVer);
    if (res !== PxtnErr.OK) return res;

    if (fmtVer.fmt === FmtVer.X1x) {
      pCount.value = MAX_FMTVER_X1X_EVENTNUM;
      return PxtnErr.OK;
    }

    let count = 0;
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
          if (typeof n !== "number") return n;
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

    // X3x 以前のフォーマットは unit ごとに voice_no / group_no / key tuning / key event の
    // 4 イベントが暗黙に読まれるため、その分を上限に見積もりへ加える (元C++コメントより)
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
        res = woice.ioMateOggvR(desc);
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

  // 名前付きアイテムの読み込み (size=20: u16 index + u16 reserved + 名前)
  private _ioAssiNameR(desc: MemoryIo, nameBytes: number, indexMax: number, apply: (index: number, name: Uint8Array) => PxtnErr): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 20) return PxtnErr.FMT_UNKNOWN; // u16 + u16 + 16
    const index = ioGetU16LE(desc);
    const reserved = ioGetU16LE(desc);
    const name = ioGetBytes(desc, nameBytes);
    if (index === null || reserved === null || name === null) return PxtnErr.DESC_R;
    if (reserved) return PxtnErr.FMT_UNKNOWN;
    if (index >= indexMax) return PxtnErr.FMT_UNKNOWN;
    return apply(index, name);
  }

  private _ioAssiWoiceR(desc: MemoryIo): PxtnErr {
    return this._ioAssiNameR(desc, PXTN_MAX_TUNEWOICENAME, this._woiceNum, (index, name) =>
      this._woices[index]!.setNameBuf(name, PXTN_MAX_TUNEWOICENAME) ? PxtnErr.OK : PxtnErr.FATAL,
    );
  }

  private _ioAssiUnitR(desc: MemoryIo): PxtnErr {
    return this._ioAssiNameR(desc, PXTN_MAX_TUNE_UNIT_NAME, this._unitNum, (index, name) =>
      this._units[index]!.setNameBuf(name) ? PxtnErr.OK : PxtnErr.FATAL,
    );
  }

  private _ioUnitNumR(desc: MemoryIo, pNum: { value: number }): PxtnErr {
    if (!this._bInit) return PxtnErr.INIT;
    const size = ioGetInt32LE(desc);
    if (size === null) return PxtnErr.DESC_R;
    if (size !== 4) return PxtnErr.FMT_UNKNOWN;
    const num = ioGetU16LE(desc);
    const reserved = ioGetU16LE(desc);
    if (num === null || reserved === null) return PxtnErr.DESC_R;
    if (reserved) return PxtnErr.FMT_UNKNOWN;
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
        case Tag.MateOggv: {
          const res = this._ioReadWoice(desc, WoiceType.OGGV);
          if (res !== PxtnErr.OK) return res;
          break;
        }
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

    // 編集モードでは既存のビートクロック設定を保持する (読み込みでは上書きしない)
    if (this._bEdit && this.master.beatClock !== EVENTDEFAULT_BEATCLOCK) return PxtnErr.DENY_BEATCLOCK;

    // イベントとマスターの最終位置のうち、より後ろまで小節数を伸ばす
    const clock1 = this.evels.maxClock;
    const clock2 = this.master.lastClock;
    this.master.adjustMeasNum(Math.max(clock1, clock2));

    this._mooBValidData = true;
    return PxtnErr.OK;
  }

  private _x3xTuningKeyEvent(): boolean {
    if (!this._bInit) return false;
    if (this._unitNum > this._woiceNum) return false;
    for (let u = 0; u < this._unitNum; u++) {
      const changeValue = this._woices[u]!.x3xBasicKey - EVENTDEFAULT_BASICKEY;
      if (!this.evels.countByUnitKind(u, EventKind.KEY)) {
        this.evels.recordAddI(0, u, EventKind.KEY, EVENTDEFAULT_KEY);
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

  // x1x project 形式: size(4) + 名前(16) + テンポ(4) + クロック/拍子(4) + 予約(8) + sps(4)
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
    // 以降のフィールドは旧形式で使われないため読み捨てる
    void ioGetU16LE(desc); // beat_note
    void ioGetU16LE(desc); // meas_num
    void ioGetU16LE(desc); // channel_num
    void ioGetU16LE(desc); // bps
    void ioGetUint32LE(desc); // sps

    // 名前は NUL 終端。ここまでのバイト列を名前に使う
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
    // ビート分解能: tune は CLOCK_ROUGH に量子化して書き出す
    const quantizeBits = bTune ? CLOCK_ROUGH : 1;
    const code = bTune ? CODE_TUNE_V5 : CODE_PROJ_V5;
    ioPutAsciiString(desc, code);
    ioPutU16LE(desc, exeVer);
    ioPutU16LE(desc, 0);

    ioPutAsciiString(desc, CODE_MASTERV5);
    if (!this.master.ioWV5(desc, quantizeBits)) return PxtnErr.DESC_W;

    ioPutAsciiString(desc, CODE_EVENT_V5);
    if (!this.evels.ioWrite(desc, quantizeBits)) return PxtnErr.DESC_W;

    if (this.text.hasName) {
      ioPutAsciiString(desc, CODE_TEXTNAME);
      if (!this.text.nameW(desc)) return PxtnErr.DESC_W;
    }
    if (this.text.hasComment) {
      ioPutAsciiString(desc, CODE_TEXTCOMM);
      if (!this.text.commentW(desc)) return PxtnErr.DESC_W;
    }

    for (let d = 0; d < this._delayNum; d++) {
      ioPutAsciiString(desc, CODE_EFFEDELA);
      if (!this._delays[d]!.write(desc)) return PxtnErr.DESC_W;
    }
    for (let o = 0; o < this._ovdrvNum; o++) {
      ioPutAsciiString(desc, CODE_EFFEOVER);
      if (!this._ovdrvs[o]!.write(desc)) return PxtnErr.DESC_W;
    }

    for (let w = 0; w < this._woiceNum; w++) {
      const woice = this._woices[w]!;
      switch (woice.type) {
        case WoiceType.PCM:
          ioPutAsciiString(desc, CODE_MATEPCM);
          if (!woice.ioMatePcmW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.PTV:
          ioPutAsciiString(desc, CODE_MATEPTV);
          if (!woice.ioMatePtvW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.PTN:
          ioPutAsciiString(desc, CODE_MATEPTN);
          if (!woice.ioMatePtnW(desc)) return PxtnErr.DESC_W;
          break;
        case WoiceType.OGGV:
          // デコード済み OGGV は PCM として保存 (変換済み ptcop の生成に使用)
          if (woice.isOggvDecoded()) {
            ioPutAsciiString(desc, CODE_MATEPCM);
            if (!woice.ioMatePcmW(desc)) return PxtnErr.DESC_W;
          } else {
            ioPutAsciiString(desc, CODE_MATEOGGV);
            if (!woice.ioMateOggvW(desc)) return PxtnErr.DESC_W;
          }
          break;
        default:
          return PxtnErr.INV_DATA;
      }
      if (!bTune && woice.isNameBuf()) {
        ioPutAsciiString(desc, CODE_ASSIWOIC);
        if (!this._ioAssiWoiceW(desc, w)) return PxtnErr.DESC_W;
      }
    }

    ioPutAsciiString(desc, CODE_NUM_UNIT);
    if (!this._ioUnitNumW(desc)) return PxtnErr.DESC_W;

    for (let u = 0; u < this._unitNum; u++) {
      if (!bTune && this._units[u]!.isNameBuf()) {
        ioPutAsciiString(desc, CODE_ASSIUNIT);
        if (!this._ioAssiUnitW(desc, u)) return PxtnErr.DESC_W;
      }
    }

    ioPutAsciiString(desc, CODE_PXTONEND);
    ioPutInt32LE(desc, 0);
    return PxtnErr.OK;
  }

  // 名前付きアイテムの書き込み (size=20: u16 index + u16 reserved + 名前)
  private _ioAssiNameW(desc: MemoryIo, idx: number, nameLen: number, byteAt: (i: number) => number): boolean {
    if (!this._bInit) return false;
    ioPutInt32LE(desc, 20);
    ioPutU16LE(desc, idx);
    ioPutU16LE(desc, 0);
    for (let i = 0; i < nameLen; i++) ioPutU8(desc, byteAt(i));
    return true;
  }

  private _ioAssiWoiceW(desc: MemoryIo, idx: number): boolean {
    if (this._woices[idx]!.nameSize > PXTN_MAX_TUNEWOICENAME) return false;
    const name = this._woices[idx]!.getNameBuf();
    return this._ioAssiNameW(desc, idx, PXTN_MAX_TUNEWOICENAME, (i) => (i < name.length ? name[i]! : 0));
  }

  private _ioAssiUnitW(desc: MemoryIo, idx: number): boolean {
    const name = this._units[idx]!.name;
    return this._ioAssiNameW(desc, idx, PXTN_MAX_TUNE_UNIT_NAME, (i) => (i < name.length ? name.charCodeAt(i) : 0));
  }

  private _ioUnitNumW(desc: MemoryIo): boolean {
    if (!this._bInit) return false;
    ioPutInt32LE(desc, 4);
    ioPutU16LE(desc, this._unitNum);
    ioPutU16LE(desc, 0);
    return true;
  }

  // ---------- Moo (レンダラー) ----------

  mooIsValidData(): boolean {
    if (!this._bInit) return false;
    return this._mooBValidData;
  }

  mooIsEndVomit(): boolean {
    if (!this._bInit) return true;
    return this._mooBEndVomit;
  }

  mooGetNowClock(): number {
    if (!this._bInit) return 0;
    if (this._mooClockRate) return Math.trunc(this._mooSmpCount / this._mooClockRate);
    return 0;
  }

  mooGetEndClock(): number {
    if (!this._bInit) return 0;
    if (this._mooClockRate) return Math.trunc(this._mooSmpEnd / this._mooClockRate);
    return 0;
  }

  mooSetMuteByUnit(b: boolean): boolean {
    if (!this._bInit) return false;
    this._mooBMuteByUnit = b;
    return true;
  }

  mooSetLoop(b: boolean): boolean {
    if (!this._bInit) return false;
    this._mooBLoop = b;
    return true;
  }

  mooSetFade(fade: number, sec: number): boolean {
    if (!this._bInit) return false;
    // C++ は (float)dst_sps * sec を float で計算してから 8bit 固定小数にする
    this._mooFadeMax = Math.trunc(Math.fround(this._dstSps * Math.fround(sec))) >> 8;
    if (fade < 0) {
      this._mooFadeDir = -1;
      this._mooFadeCount = this._mooFadeMax << 8;
    } else if (fade > 0) {
      this._mooFadeDir = 1;
      this._mooFadeCount = 0;
    } else {
      this._mooFadeDir = 0;
      this._mooFadeCount = 0;
    }
    return true;
  }

  mooSetMasterVolume(v: number): boolean {
    if (!this._bInit) return false;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    // C++ は float 精度で保持する
    this._mooMasterVol = Math.fround(v);
    return true;
  }

  mooGetSamplingOffset(): number {
    if (!this._bInit) return 0;
    if (this._mooBEndVomit) return 0;
    return this._mooSmpCount;
  }

  mooGetSamplingEnd(): number {
    if (!this._bInit) return 0;
    if (this._mooBEndVomit) return 0;
    return this._mooSmpEnd;
  }

  mooGetTotalSample(): number {
    if (!this._bInit) return 0;
    if (!this._mooBValidData) return 0;
    return pxtnServiceMooCalcSampleNum(this.master.measNum, this.master.beatNum, this._dstSps, this.master.beatTempo);
  }

  mooPreparation(prep: VomitPreparation | null): boolean {
    if (!this._bInit || !this._mooBValidData || !this._dstChNum || !this._dstSps || !this._dstBytePerSmp) {
      this._mooBEndVomit = true;
      return false;
    }

    let startMeas = 0;
    let startSample = 0;
    let startFloat = 0;
    let measEnd = this.master.playMeas;
    let measRepeat = this.master.repeatMeas;
    let fadeinSec = 0;

    if (prep) {
      startMeas = prep.startPosMeas;
      startSample = prep.startPosSample;
      startFloat = prep.startPosFloat;
      if (prep.measEnd) measEnd = prep.measEnd;
      if (prep.measRepeat) measRepeat = prep.measRepeat;
      if (prep.fadeinSec) fadeinSec = prep.fadeinSec;
      if (prep.flags & PXTN_VOMIT_PREP_FLAG_UNIT_MUTE) this._mooBMuteByUnit = true;
      else this._mooBMuteByUnit = false;
      if (prep.flags & PXTN_VOMIT_PREP_FLAG_LOOP) this._mooBLoop = true;
      else this._mooBLoop = false;
      this._mooMasterVol = Math.fround(prep.masterVolume);
    }

    this._mooBtClock = this.master.beatClock;
    this._mooBtNum = this.master.beatNum;
    this._mooBtTempo = this.master.beatTempo;
    // C++ は double で計算し float に丸めて保持する
    this._mooClockRate = Math.fround((60.0 * this._dstSps) / (this._mooBtTempo * this._mooBtClock));
    // C++ は float 除算 (44100.0f / _dst_sps)
    this._mooSmpStride = Math.fround(PXTN_BASIC_SPS / this._dstSps);
    this._mooTop = 0x7fff;
    this._mooTimePanIndex = 0;

    this._mooSmpEnd = Math.trunc(measEnd * this._mooBtNum * this._mooBtClock * this._mooClockRate);
    this._mooSmpRepeat = Math.trunc(measRepeat * this._mooBtNum * this._mooBtClock * this._mooClockRate);

    if (startFloat) this._mooSmpStart = Math.trunc(this.mooGetTotalSample() * startFloat);
    else if (startSample) this._mooSmpStart = startSample;
    else this._mooSmpStart = Math.trunc(startMeas * this._mooBtNum * this._mooBtClock * this._mooClockRate);

    this._mooSmpCount = this._mooSmpStart;
    this._mooSmpSmooth = Math.trunc(this._dstSps / 250); // (0.004sec)

    if (fadeinSec > 0) this.mooSetFade(1, fadeinSec);
    else this.mooSetFade(0, 0);

    this.tonesClear();

    this._mooRecords = this.evels.records;
    this._mooPEve = 0;

    this._mooInitUnitTone();

    this._mooBEndVomit = false;
    return true;
  }

  // ON イベント: ノートを発音する。リリース中に次のノートが重なる場合は寿命を制限する
  private _mooHandleOnEvent(unit: Unit, eve: EveRecord, clock: number, records: EveRecord[]): void {
    // C++ は毎回 float 乗算するため、_mooClockRate との積を float 精度にする
    const onCount = Math.trunc(Math.fround((eve.clock + eve.value - clock) * this._mooClockRate));
    if (onCount <= 0) {
      unit.toneZeroLives();
      return;
    }
    unit.toneKeyOn();
    const woice = unit.woice;
    if (!woice) return;
    for (let v = 0; v < woice.voiceNum; v++) {
      const tone = unit.getTone(v);
      const voiceInst = woice.getInstance(v)!;

      if (voiceInst.envRelease) {
        // リリース中に次のノートが重なる場合、寿命は「このノートの終端+リリース」と「次のONまで」の短い方に制限する
        const lifeUntilRelease =
          Math.trunc(Math.fround((eve.value - (clock - eve.clock)) * this._mooClockRate)) + voiceInst.envRelease;
        let lifeUntilNextOn: number;
        // このノートの終端+リリースを過ぎた位置にある次の ON を探す
        const releaseEnd = eve.clock + eve.value + tone.envReleaseClock;
        let next: EveRecord | null = null;
        for (let q = this._mooPEve + 1; q < records.length; q++) {
          const candidate = records[q]!;
          if (candidate.clock > releaseEnd) break;
          if (candidate.unitNo === eve.unitNo && candidate.kind === EventKind.ON) {
            next = candidate;
            break;
          }
        }
        if (!next) lifeUntilNextOn = this._mooSmpEnd - Math.trunc(Math.fround(clock * this._mooClockRate));
        else lifeUntilNextOn = Math.trunc(Math.fround((next.clock - clock) * this._mooClockRate));
        if (lifeUntilRelease < lifeUntilNextOn) tone.lifeCount = lifeUntilRelease;
        else tone.lifeCount = lifeUntilNextOn;
      } else {
        tone.lifeCount = Math.trunc(Math.fround((eve.value - (clock - eve.clock)) * this._mooClockRate));
      }

      if (tone.lifeCount > 0) {
        tone.onCount = onCount;
        tone.smpPos = 0;
        tone.envPos = 0;
        if (voiceInst.envSize) tone.envVolume = tone.envStart = 0; // envelope
        else tone.envVolume = tone.envStart = 128; // no-envelope
      }
    }
  }

  // 1サンプル分を合成して [L,R] を返す。終了時は null
  private _mooPxtoneSample(): [number, number] | null {
    // envelope..
    for (let u = 0; u < this._unitNum; u++) this._units[u]!.toneEnvelope();

    const clock = Math.trunc(this._mooSmpCount / this._mooClockRate);
    const records = this._mooRecords;

    // events..
    for (; this._mooPEve >= 0 && this._mooPEve < records.length && records[this._mooPEve]!.clock <= clock; this._mooPEve++) {
      const eve = records[this._mooPEve]!;
      const unit = this._units[eve.unitNo]!;

      switch (eve.kind) {
        case EventKind.ON:
          this._mooHandleOnEvent(unit, eve, clock, records);
          break;
        case EventKind.KEY:
          unit.toneKey(eve.value);
          break;
        case EventKind.PAN_VOLUME:
          unit.tonePanVolume(this._dstChNum, eve.value);
          break;
        case EventKind.PAN_TIME:
          unit.tonePanTime(this._dstChNum, eve.value, this._dstSps);
          break;
        case EventKind.VELOCITY:
          unit.toneVelocity(eve.value);
          break;
        case EventKind.VOLUME:
          unit.toneVolume(eve.value);
          break;
        case EventKind.PORTAMENT:
          unit.tonePortament(Math.trunc(Math.fround(eve.value * this._mooClockRate)));
          break;
        // ビート・リピート系イベントは mooPreparation の時点でマスターに反映済みのため無視する
        case EventKind.BEATCLOCK:
        case EventKind.BEATTEMPO:
        case EventKind.BEATNUM:
        case EventKind.REPEAT:
        case EventKind.LAST:
          break;
        case EventKind.VOICENO:
          this._mooResetVoiceOn(unit, eve.value);
          break;
        case EventKind.GROUPNO:
          unit.toneGroupNo(eve.value);
          break;
        case EventKind.TUNING:
          unit.toneTuning(int32ToFloat(eve.value));
          break;
      }
    }

    // sampling..
    for (let u = 0; u < this._unitNum; u++) {
      this._units[u]!.toneSample(this._mooBMuteByUnit, this._dstChNum, this._mooTimePanIndex, this._mooSmpSmooth);
    }

    const out: [number, number] = [0, 0];
    for (let ch = 0; ch < this._dstChNum; ch++) {
      this._mooGroupSmps!.fill(0);
      for (let u = 0; u < this._unitNum; u++) this._units[u]!.toneSupple(this._mooGroupSmps!, ch, this._mooTimePanIndex);
      for (let o = 0; o < this._ovdrvNum; o++) this._ovdrvs[o]!.toneSupple(this._mooGroupSmps!);
      for (let d = 0; d < this._delayNum; d++) this._delays[d]!.toneSupple(ch, this._mooGroupSmps!);

      // collect.
      let sample = 0;
      for (let g = 0; g < this._groupNum; g++) sample += this._mooGroupSmps![g]!;

      // フェード: count>>8 は 8bit 固定小数の経過位置なので、max で割って 0..1 のゲインにする
      if (this._mooFadeDir) sample = Math.trunc((sample * (this._mooFadeCount >> 8)) / this._mooFadeMax);

      // master volume (C++ は work と float 精度の音量を float 積算する)
      sample = Math.trunc(Math.fround(Math.fround(sample) * this._mooMasterVol));

      // to buffer..
      if (sample > this._mooTop) sample = this._mooTop;
      if (sample < -this._mooTop) sample = -this._mooTop;
      out[ch] = sample;
    }

    // increments..
    this._mooSmpCount++;
    // PXTN_BUFSIZE_TIMEPAN は 2 のべき乗のため、ビットマスクで循環させる
    this._mooTimePanIndex = (this._mooTimePanIndex + 1) & (PXTN_BUFSIZE_TIMEPAN - 1);

    for (let u = 0; u < this._unitNum; u++) {
      const keyNow = this._units[u]!.toneIncrementKey();
      // C++ はピッチ (float) と _moo_smp_stride (float) の積を float で計算する
      this._units[u]!.toneIncrementSample(Math.fround(this._mooFreq!.get2(keyNow) * this._mooSmpStride));
    }

    // delay
    for (let d = 0; d < this._delayNum; d++) this._delays[d]!.toneIncrement();

    // fade out
    if (this._mooFadeDir < 0) {
      if (this._mooFadeCount > 0) this._mooFadeCount--;
      else return null;
    } else if (this._mooFadeDir > 0) {
      // fade in
      if (this._mooFadeCount < this._mooFadeMax << 8) this._mooFadeCount++;
      else this._mooFadeDir = 0;
    }

    if (this._mooSmpCount >= this._mooSmpEnd) {
      if (!this._mooBLoop) return null;
      this._mooSmpCount = this._mooSmpRepeat;
      this._mooPEve = 0;
      this._mooInitUnitTone();
    }
    return out;
  }

  private _mooResetVoiceOn(unit: Unit, woiceNo: number): boolean {
    if (!this._bInit) return false;
    const woice = this.woiceGet(woiceNo);
    if (!woice) return false;
    unit.setWoice(woice);
    for (let v = 0; v < woice.voiceNum; v++) {
      const voiceInst = woice.getInstance(v)!;
      const voice = woice.getVoice(v)!;
      let ofsFreq = 0;
      if (voice.voiceFlags & PTV_VOICEFLAG_BEATFIT) {
        // 1 分あたりのサンプル数 (基準 sps × 60 秒) から BEATFIT のオフセット周波数を求める
        // C++ は分母分子とも float で計算する
        ofsFreq = Math.fround(
          Math.fround(voiceInst.smpBodyW * this._mooBtTempo) / Math.fround(PXTN_BASIC_SPS * 60 * voice.tuning),
        );
      } else {
        ofsFreq = Math.fround(this._mooFreq!.get(EVENTDEFAULT_BASICKEY - voice.basicKey) * voice.tuning);
      }
      unit.toneResetAnd2prm(
        v,
        Math.trunc(Math.fround(Math.fround(voiceInst.envRelease) / this._mooClockRate)),
        ofsFreq,
      );
    }
    return true;
  }

  private _mooInitUnitTone(): boolean {
    if (!this._bInit) return false;
    for (let u = 0; u < this._unitNum; u++) {
      const unit = this._units[u]!;
      unit.toneInit();
      this._mooResetVoiceOn(unit, EVENTDEFAULT_VOICENO);
    }
    return true;
  }

  // バッファへ出力。buf は Int16Array、長さ = smpNum * _dstChNum
  Moo(buf: Int16Array, smpNum: number): boolean {
    if (!this._bInit) return false;
    if (!this._mooBValidData) return false;
    if (this._mooBEndVomit) return false;

    let smpW = 0;
    for (smpW = 0; smpW < smpNum; smpW++) {
      const sample = this._mooPxtoneSample();
      if (sample === null) {
        this._mooBEndVomit = true;
        break;
      }
      for (let ch = 0; ch < this._dstChNum; ch++) buf[smpW * this._dstChNum + ch] = sample[ch]!;
    }
    for (; smpW < smpNum; smpW++) {
      for (let ch = 0; ch < this._dstChNum; ch++) buf[smpW * this._dstChNum + ch] = 0;
    }
    return true;
  }
}

export interface VomitPreparation {
  startPosMeas: number;
  startPosSample: number;
  startPosFloat: number;
  measEnd: number;
  measRepeat: number;
  fadeinSec: number;
  flags: number;
  masterVolume: number;
}

export function pxtnServiceMooCalcSampleNum(measNum: number, beatNum: number, sps: number, beatTempo: number): number {
  if (!beatTempo) return 0;
  const totalBeatNum = measNum * beatNum;
  return Math.trunc((sps * 60 * totalBeatNum) / beatTempo);
}
