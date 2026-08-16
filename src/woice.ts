// pxtnWoice.cpp / pxtnWoicePTV.cpp / pxtnWoice_io.cpp 相当
// 音色データ + PCM キャッシュ変換

import { PxtnErr } from "./error.js";
import type { OggvDecoder, OggvDecoded } from "./oggv.js";
import {
  MemoryIo,
  SEEK_CUR,
  dataCheckVSize,
  dataReadV,
  dataWriteV,
  floatToInt32Bits,
  int32ToFloat,
  ioGetBytes,
  ioGetFloatLE,
  ioGetInt32LE,
  ioGetU16LE,
  ioGetU8,
  ioGetUint16LE,
  ioGetUint32LE,
  ioGetAsciiExact,
  ioPutAsciiString,
  ioPutFloatLE,
  ioPutInt32LE,
  ioPutU16LE,
  ioPutU8,
  ioPutUint32LE,
  stringToAsciiBytes,
} from "./data.js";
import { Pcm } from "./pcm.js";
import { Noise } from "./noise.js";
import type { NoiseBuilder } from "./noise-builder.js";
import { EVENTDEFAULT_BASICKEY, panToVolumes } from "./event.js";
import { PXTN_BASIC_SPS, PXTN_MAX_TUNEWOICENAME } from "./constants.js";
import { Oscillator, type PulsePoint } from "./osc.js";

// PTV 座標波形のキャッシュ長 (サンプル数)。C++ 実装の固定値に合わせる
const PTV_CACHE_SAMPLE_NUM = 400;

export enum WoiceType {
  None = 0,
  PCM,
  PTV,
  PTN,
  OGGV,
}

export enum VoiceType {
  Coodinate = 0,
  Overtone,
  Noise,
  Sampling,
  OggVorbis,
}

export const PTV_VOICEFLAG_WAVELOOP = 0x00000001;
export const PTV_VOICEFLAG_SMOOTH = 0x00000002;
export const PTV_VOICEFLAG_BEATFIT = 0x00000004;
export const PTV_VOICEFLAG_UNCOVERED = 0xfffffff8;

export const PTV_DATAFLAG_WAVE = 0x00000001;
export const PTV_DATAFLAG_ENVELOPE = 0x00000002;
export const PTV_DATAFLAG_UNCOVERED = 0xfffffffc;

export interface VoiceEnvelope {
  fps: number;
  headNum: number;
  bodyNum: number;
  tailNum: number;
  points: PulsePoint[];
}

export interface VoiceUnit {
  basicKey: number;
  volume: number;
  pan: number;
  tuning: number;
  voiceFlags: number;
  dataFlags: number;
  type: VoiceType;
  pcm: Pcm;
  ptn: Noise;
  wave: { num: number; reso: number; points: PulsePoint[] };
  envelope: VoiceEnvelope;
  // OGGV: 生 ogg データ (ptcop 内の表現)。デコード後も保存用に保持する
  oggv: { ch: number; sps: number; smpNum: number; data: Uint8Array } | null;
  // OGGV が decodeOggv() で PCM 化済みか
  oggvDecoded: boolean;
}

export interface VoiceInstance {
  smpHeadW: number;
  smpBodyW: number;
  smpTailW: number;
  pSmpW: Uint8Array | null;
  pEnv: Uint8Array | null;
  envSize: number;
  envRelease: number;
  bSineOver: boolean;
}

const PTV_FILEID = "PTVOICE-";
const PTV_VERSION = 20060111;

function newVoiceUnit(): VoiceUnit {
  return {
    basicKey: EVENTDEFAULT_BASICKEY,
    volume: 128,
    pan: 64,
    tuning: 1.0,
    voiceFlags: PTV_VOICEFLAG_SMOOTH,
    dataFlags: PTV_DATAFLAG_WAVE,
    type: VoiceType.Coodinate,
    pcm: new Pcm(),
    ptn: new Noise(),
    wave: { num: 0, reso: 0, points: [] },
    envelope: { fps: 0, headNum: 0, bodyNum: 0, tailNum: 0, points: [] },
    oggv: null,
    oggvDecoded: false,
  };
}

function newVoiceInstance(): VoiceInstance {
  return {
    smpHeadW: 0,
    smpBodyW: 0,
    smpTailW: 0,
    pSmpW: null,
    pEnv: null,
    envSize: 0,
    envRelease: 0,
    bSineOver: false,
  };
}

function releaseVoiceUnit(unit: VoiceUnit): void {
  unit.wave.points = [];
  unit.wave.num = 0;
  unit.wave.reso = 0;
  unit.envelope = { fps: 0, headNum: 0, bodyNum: 0, tailNum: 0, points: [] };
}

export class Woice {
  private _voiceNum = 0;
  private _name: Uint8Array = new Uint8Array(0);
  private _type = WoiceType.None;
  private _voices: VoiceUnit[] = [];
  private _voinsts: VoiceInstance[] = [];
  private _x3xTuning = 0;
  private _x3xBasicKey = 0;

  get voiceNum(): number {
    return this._voiceNum;
  }
  get x3xBasicKey(): number {
    return this._x3xBasicKey;
  }
  get x3xTuning(): number {
    return this._x3xTuning;
  }
  get type(): WoiceType {
    return this._type;
  }

  getVoice(idx: number): VoiceUnit | null {
    if (idx < 0 || idx >= this._voiceNum) return null;
    return this._voices[idx]!;
  }

  getInstance(idx: number): VoiceInstance | null {
    if (idx < 0 || idx >= this._voiceNum) return null;
    return this._voinsts[idx]!;
  }

  setNameBuf(name: Uint8Array | string, bufSize?: number): boolean {
    const bytes = typeof name === "string" ? stringToAsciiBytes(name) : name;
    const size = bufSize ?? bytes.length;
    if (size < 0 || size > PXTN_MAX_TUNEWOICENAME) return false;
    this._name = new Uint8Array(PXTN_MAX_TUNEWOICENAME);
    this._name.fill(0);
    if (size) this._name.set(bytes.subarray(0, size));
    return true;
  }

  getNameBuf(): Uint8Array {
    return this._name;
  }

  get nameSize(): number {
    for (let i = 0; i < this._name.length; i++) {
      if (this._name[i] === 0) return i;
    }
    return this._name.length;
  }

  isNameBuf(): boolean {
    return this.nameSize > 0;
  }

  voiceAllocate(voiceNum: number): boolean {
    this.voiceRelease();
    this._voices = [];
    this._voinsts = [];
    for (let i = 0; i < voiceNum; i++) {
      this._voices.push(newVoiceUnit());
      this._voinsts.push(newVoiceInstance());
    }
    this._voiceNum = voiceNum;
    return true;
  }

  voiceRelease(): void {
    for (const unit of this._voices) releaseVoiceUnit(unit);
    this._voices = [];
    this._voinsts = [];
    this._voiceNum = 0;
  }

  slim(): void {
    for (let i = this._voiceNum - 1; i >= 0; i--) {
      const vc = this._voices[i]!;
      // 無音 (volume 0) または波形が 1 点未満の音色は削除して詰める
      let bRemove = false;
      if (!vc.volume) bRemove = true;
      if (vc.type === VoiceType.Coodinate && vc.wave.num <= 1) bRemove = true;
      if (bRemove) {
        releaseVoiceUnit(vc);
        this._voices.splice(i, 1);
        this._voinsts.splice(i, 1);
        this._voiceNum--;
      }
    }
  }

  copy(dst: Woice): boolean {
    if (!dst.voiceAllocate(this._voiceNum)) return false;
    dst._type = this._type;
    dst._name = new Uint8Array(this._name);
    for (let v = 0; v < this._voiceNum; v++) {
      const s = this._voices[v]!;
      const d = dst._voices[v]!;
      d.tuning = s.tuning;
      d.dataFlags = s.dataFlags;
      d.basicKey = s.basicKey;
      d.pan = s.pan;
      d.type = s.type;
      d.voiceFlags = s.voiceFlags;
      d.volume = s.volume;
      d.envelope = {
        ...s.envelope,
        points: s.envelope.points.map((p) => ({ ...p })),
      };
      d.wave = { num: s.wave.num, reso: s.wave.reso, points: s.wave.points.map((p) => ({ ...p })) };
      d.oggv = s.oggv ? { ...s.oggv, data: new Uint8Array(s.oggv.data) } : null;
      d.oggvDecoded = s.oggvDecoded;
      if (!d.pcm.copyFrom(s.pcm)) return false;
      if (!d.ptn.copyFrom(s.ptn)) return false;
    }
    return true;
  }

  read(io: MemoryIo, type: WoiceType): PxtnErr {
    let res: PxtnErr = PxtnErr.VOID;
    switch (type) {
      case WoiceType.PCM: {
        if (!this.voiceAllocate(1)) return PxtnErr.MEMORY;
        const vc = this._voices[0]!;
        vc.type = VoiceType.Sampling;
        res = vc.pcm.read(io);
        if (res !== PxtnErr.OK) return res;
        // 0.005 秒未満の短い PCM は一瞬で鳴り終わってしまうためループ再生にする
        if (vc.pcm.sec < 0.005) vc.voiceFlags |= PTV_VOICEFLAG_WAVELOOP;
        else vc.voiceFlags &= ~PTV_VOICEFLAG_WAVELOOP;
        this._type = WoiceType.PCM;
        break;
      }
      case WoiceType.PTV:
        res = this.ptvRead(io);
        if (res !== PxtnErr.OK) return res;
        break;
      case WoiceType.PTN: {
        if (!this.voiceAllocate(1)) return PxtnErr.MEMORY;
        const vc = this._voices[0]!;
        vc.type = VoiceType.Noise;
        res = vc.ptn.read(io);
        if (res !== PxtnErr.OK) return res;
        this._type = WoiceType.PTN;
        break;
      }
      case WoiceType.OGGV:
        res = this.ioMateOggvR(io);
        break;
      default:
        return PxtnErr.VOID;
    }
    return PxtnErr.OK;
  }

  private updateWavePTV(vc: VoiceUnit, vi: VoiceInstance, ch: number, bps: number): void {
    const osci = new Oscillator();
    const panVolume = ch === 2 ? panToVolumes(vc.pan) : [64, 64] as [number, number];
    osci.readyGetSample(vc.wave.points, vc.wave.num, vc.volume, vi.smpBodyW, vc.wave.reso);
    const isOvertone = vc.type === VoiceType.Overtone;
    vi.bSineOver = false;
    const p = vi.pSmpW!;
    const is8bit = bps === 8;
    for (let s = 0; s < vi.smpBodyW; s++) {
      const osc = isOvertone ? osci.getOneSampleOvertone(s) : osci.getOneSampleCoodinate(s);
      for (let c = 0; c < ch; c++) {
        let work = (osc * panVolume[c]!) / 64;
        if (work > 1.0) {
          work = 1.0;
          vi.bSineOver = true;
        }
        if (work < -1.0) {
          work = -1.0;
          vi.bSineOver = true;
        }
        const sample = s * ch + c;
        if (is8bit) {
          // 8bit は符号なし (0..255)
          p[sample] = Math.trunc(work * 127) + 128;
        } else {
          // 16bit はリトルエンディアンで 2 バイトに分割して書き込む
          const v = Math.trunc(work * 32767);
          p[sample * 2] = v & 0xff;
          p[sample * 2 + 1] = (v >> 8) & 0xff;
        }
      }
    }
  }

  toneReadySample(ptnBldr: NoiseBuilder | null): PxtnErr {
    const ch = 2;
    const sps = PXTN_BASIC_SPS;
    const bps = 16;
    for (let v = 0; v < this._voiceNum; v++) {
      const vi = this._voinsts[v]!;
      vi.pSmpW = null;
      vi.smpHeadW = 0;
      vi.smpBodyW = 0;
      vi.smpTailW = 0;
    }
    const pcmWork = new Pcm();
    for (let v = 0; v < this._voiceNum; v++) {
      const vi = this._voinsts[v]!;
      const vc = this._voices[v]!;
      switch (vc.type) {
        case VoiceType.Sampling:
        case VoiceType.OggVorbis: {
          // OGGV は decodeOggv() で PCM 化済みである必要がある
          if (vc.type === VoiceType.OggVorbis && !vc.oggvDecoded) return PxtnErr.OGG_NO_SUPPORTED;
          if (!pcmWork.copyFrom(vc.pcm)) return PxtnErr.PCM_UNKNOWN;
          if (!pcmWork.convert(ch, sps, bps)) return PxtnErr.PCM_CONVERT;
          vi.smpHeadW = pcmWork.smpHead;
          vi.smpBodyW = pcmWork.smpBody;
          vi.smpTailW = pcmWork.smpTail;
          vi.pSmpW = pcmWork.devolveSamplingBuffer();
          break;
        }
        case VoiceType.Overtone:
        case VoiceType.Coodinate: {
          // PTV 波形のキャッシュ長は固定 400 サンプル (C++ 実装と同一)
          vi.smpBodyW = PTV_CACHE_SAMPLE_NUM;
          const size = (vi.smpBodyW * ch * bps) / 8;
          vi.pSmpW = new Uint8Array(size);
          vi.pSmpW.fill(0);
          this.updateWavePTV(vc, vi, ch, bps);
          break;
        }
        case VoiceType.Noise: {
          if (!ptnBldr) return PxtnErr.PTN_INIT;
          const pPcm = ptnBldr.buildNoise(vc.ptn, ch, sps, bps);
          if (!pPcm) return PxtnErr.PTN_BUILD;
          vi.pSmpW = pPcm.devolveSamplingBuffer();
          vi.smpBodyW = vc.ptn.smpNum44k;
          break;
        }
        default:
          break;
      }
    }
    return PxtnErr.OK;
  }

  toneReadyEnvelope(sps: number): PxtnErr {
    for (let v = 0; v < this._voiceNum; v++) {
      const vi = this._voinsts[v]!;
      const vc = this._voices[v]!;
      const enve = vc.envelope;
      vi.pEnv = null;
      if (enve.headNum) {
        let size = 0;
        for (let e = 0; e < enve.headNum; e++) size += enve.points[e]!.x;
        vi.envSize = Math.trunc((size * sps) / enve.fps);
        if (!vi.envSize) vi.envSize = 1;
        vi.pEnv = new Uint8Array(vi.envSize);
        const pointList: PulsePoint[] = [];
        let offset = 0;
        let headCount = 0;
        for (let e = 0; e < enve.headNum; e++) {
          // 先頭点、または座標が非ゼロの変化点のみを保持する (重複点を除去)
          if (!e || enve.points[e]!.x || enve.points[e]!.y) {
            offset += Math.trunc((enve.points[e]!.x * sps) / enve.fps);
            pointList.push({ x: offset, y: enve.points[e]!.y });
            headCount++;
          }
        }
        let startX = 0;
        let startY = 0;
        let ei = 0;
        for (let s = 0; s < vi.envSize; s++) {
          while (ei < headCount && s >= pointList[ei]!.x) {
            startX = pointList[ei]!.x;
            startY = pointList[ei]!.y;
            ei++;
          }
          if (ei < headCount) {
            const p = pointList[ei]!;
            vi.pEnv[s] = Math.trunc(startY + ((p.y - startY) * (s - startX)) / (p.x - startX));
          } else {
            vi.pEnv[s] = Math.trunc(startY);
          }
        }
      }
      if (enve.tailNum) {
        vi.envRelease = Math.trunc((enve.points[enve.headNum]!.x * sps) / enve.fps);
      } else {
        vi.envRelease = 0;
      }
    }
    return PxtnErr.OK;
  }

  toneReady(ptnBldr: NoiseBuilder | null, sps: number): PxtnErr {
    const r = this.toneReadySample(ptnBldr);
    if (r !== PxtnErr.OK) return r;
    return this.toneReadyEnvelope(sps);
  }

  // ---- PTV ----

  ptvWrite(io: MemoryIo): number {
    let total = 0;
    if (!ioPutAsciiString(io, PTV_FILEID)) return -1;
    ioPutUint32LE(io, PTV_VERSION);
    ioPutInt32LE(io, 0); // size placeholder
    // x3x_basic_key と予約フィールド 2 つ (x3x 形式との互換のため 0 で書く)
    for (let i = 0; i < 3; i++) {
      if (!dataWriteV(io, 0)) return -1;
      total += dataCheckVSize(0);
    }
    if (!dataWriteV(io, this._voiceNum)) return -1;
    total += dataCheckVSize(this._voiceNum);
    for (let v = 0; v < this._voiceNum; v++) {
      const vc = this._voices[v]!;
      const vals = [vc.basicKey, vc.volume, vc.pan, floatToInt32Bits(vc.tuning), vc.voiceFlags, vc.dataFlags];
      for (const val of vals) {
        if (!dataWriteV(io, val)) return -1;
        total += dataCheckVSize(val);
      }
      if (vc.dataFlags & PTV_DATAFLAG_WAVE) {
        const t = this.writeWave(io, vc);
        if (t < 0) return -1;
        total += t;
      }
      if (vc.dataFlags & PTV_DATAFLAG_ENVELOPE) {
        const t = this.writeEnvelope(io, vc);
        if (t < 0) return -1;
        total += t;
      }
    }
    // 先頭のサイズフィールドに総バイト数を書き戻す
    if (!io.seek(SEEK_CUR, -(total + 4))) return -1;
    ioPutInt32LE(io, total);
    if (!io.seek(SEEK_CUR, total)) return -1;
    // 戻り値 = ファイル全体のバイト数 (ヘッダ 16 バイト + データ部)
    return 16 + total;
  }

  private writeWave(io: MemoryIo, vc: VoiceUnit): number {
    let add = 0;
    if (!dataWriteV(io, vc.type)) return -1;
    add += dataCheckVSize(vc.type);
    switch (vc.type) {
      case VoiceType.Coodinate: {
        if (!dataWriteV(io, vc.wave.num)) return -1;
        add += dataCheckVSize(vc.wave.num);
        if (!dataWriteV(io, vc.wave.reso)) return -1;
        add += dataCheckVSize(vc.wave.reso);
        for (let i = 0; i < vc.wave.num; i++) {
          ioPutU8(io, vc.wave.points[i]!.x & 0xff);
          add += 1;
          // y は符号付き (-128..127) のため、int8 に符号拡張してから 8bit として書き出す
          ioPutU8(io, ((vc.wave.points[i]!.y << 24) >> 24) & 0xff);
          add += 1;
        }
        break;
      }
      case VoiceType.Overtone: {
        if (!dataWriteV(io, vc.wave.num)) return -1;
        add += dataCheckVSize(vc.wave.num);
        for (let i = 0; i < vc.wave.num; i++) {
          if (!dataWriteV(io, vc.wave.points[i]!.x)) return -1;
          add += dataCheckVSize(vc.wave.points[i]!.x);
          if (!dataWriteV(io, vc.wave.points[i]!.y)) return -1;
          add += dataCheckVSize(vc.wave.points[i]!.y);
        }
        break;
      }
      case VoiceType.Sampling: {
        if (!dataWriteV(io, vc.pcm.ch)) return -1;
        add += dataCheckVSize(vc.pcm.ch);
        if (!dataWriteV(io, vc.pcm.bps)) return -1;
        add += dataCheckVSize(vc.pcm.bps);
        if (!dataWriteV(io, vc.pcm.sps)) return -1;
        add += dataCheckVSize(vc.pcm.sps);
        if (!dataWriteV(io, vc.pcm.smpHead)) return -1;
        add += dataCheckVSize(vc.pcm.smpHead);
        if (!dataWriteV(io, vc.pcm.smpBody)) return -1;
        add += dataCheckVSize(vc.pcm.smpBody);
        if (!dataWriteV(io, vc.pcm.smpTail)) return -1;
        add += dataCheckVSize(vc.pcm.smpTail);
        const size = vc.pcm.bufSize;
        if (!vc.pcm.pBuf) return -1;
        io.write(vc.pcm.pBuf, 1, size);
        add += size;
        break;
      }
      default:
        return -1;
    }
    return add;
  }

  private writeEnvelope(io: MemoryIo, vc: VoiceUnit): number {
    let add = 0;
    const enve = vc.envelope;
    const vals = [enve.fps, enve.headNum, enve.bodyNum, enve.tailNum];
    for (const v of vals) {
      if (!dataWriteV(io, v)) return -1;
      add += dataCheckVSize(v);
    }
    const num = enve.headNum + enve.bodyNum + enve.tailNum;
    for (let i = 0; i < num; i++) {
      if (!dataWriteV(io, enve.points[i]!.x)) return -1;
      add += dataCheckVSize(enve.points[i]!.x);
      if (!dataWriteV(io, enve.points[i]!.y)) return -1;
      add += dataCheckVSize(enve.points[i]!.y);
    }
    return add;
  }

  ptvRead(io: MemoryIo): PxtnErr {
    let res: PxtnErr = PxtnErr.VOID;
    const code = ioGetAsciiExact(io, 8);
    if (code === null) return PxtnErr.DESC_R;
    const version = ioGetInt32LE(io);
    if (version === null) return PxtnErr.DESC_R;
    if (code !== PTV_FILEID) return PxtnErr.INV_CODE;
    const total = ioGetInt32LE(io);
    if (total === null) return PxtnErr.DESC_R;
    if (version > PTV_VERSION) return PxtnErr.FMT_NEW;
    // 残りデータの総サイズ。整合性確認のみに使えるが、ここでは読み捨てる

    const x3xBasicKey = dataReadV(io);
    if (x3xBasicKey === null) return PxtnErr.DESC_R;
    this._x3xBasicKey = x3xBasicKey;
    const reserved1 = dataReadV(io);
    if (reserved1 === null) return PxtnErr.DESC_R;
    const reserved2 = dataReadV(io);
    if (reserved2 === null) return PxtnErr.DESC_R;
    if (reserved1 || reserved2) return PxtnErr.FMT_UNKNOWN;
    const num = dataReadV(io);
    if (num === null) return PxtnErr.DESC_R;
    if (!this.voiceAllocate(num)) return PxtnErr.MEMORY;

    for (let v = 0; v < this._voiceNum; v++) {
      const vc = this._voices[v]!;
      const basicKey = dataReadV(io);
      if (basicKey === null) return PxtnErr.DESC_R;
      vc.basicKey = basicKey;
      const vol = dataReadV(io);
      if (vol === null) return PxtnErr.DESC_R;
      vc.volume = vol;
      const pan = dataReadV(io);
      if (pan === null) return PxtnErr.DESC_R;
      vc.pan = pan;
      const tune = dataReadV(io);
      if (tune === null) return PxtnErr.DESC_R;
      vc.tuning = int32ToFloat(tune);
      const vf = dataReadV(io);
      if (vf === null) return PxtnErr.DESC_R;
      vc.voiceFlags = vf;
      const df = dataReadV(io);
      if (df === null) return PxtnErr.DESC_R;
      vc.dataFlags = df;
      if (vc.voiceFlags & PTV_VOICEFLAG_UNCOVERED) return PxtnErr.FMT_UNKNOWN;
      if (vc.dataFlags & PTV_DATAFLAG_UNCOVERED) return PxtnErr.FMT_UNKNOWN;
      if (vc.dataFlags & PTV_DATAFLAG_WAVE) {
        res = this.readWave(io, vc);
        if (res !== PxtnErr.OK) return res;
      }
      if (vc.dataFlags & PTV_DATAFLAG_ENVELOPE) {
        res = this.readEnvelope(io, vc);
        if (res !== PxtnErr.OK) return res;
      }
    }
    this._type = WoiceType.PTV;
    return PxtnErr.OK;
  }

  private readWave(io: MemoryIo, vc: VoiceUnit): PxtnErr {
    const t = dataReadV(io);
    if (t === null) return PxtnErr.DESC_R;
    vc.type = t;
    switch (vc.type) {
      case VoiceType.Coodinate: {
        const num = dataReadV(io);
        if (num === null) return PxtnErr.DESC_R;
        vc.wave.num = num;
        const reso = dataReadV(io);
        if (reso === null) return PxtnErr.DESC_R;
        vc.wave.reso = reso;
        vc.wave.points = [];
        for (let i = 0; i < num; i++) {
          const x = ioGetU8(io);
          if (x === null) return PxtnErr.DESC_R;
          const yb = ioGetU8(io);
          if (yb === null) return PxtnErr.DESC_R;
          vc.wave.points.push({ x, y: (yb << 24) >> 24 });
        }
        break;
      }
      case VoiceType.Overtone: {
        const num = dataReadV(io);
        if (num === null) return PxtnErr.DESC_R;
        vc.wave.num = num;
        vc.wave.points = [];
        for (let i = 0; i < num; i++) {
          const x = dataReadV(io);
          if (x === null) return PxtnErr.DESC_R;
          const y = dataReadV(io);
          if (y === null) return PxtnErr.DESC_R;
          vc.wave.points.push({ x, y });
        }
        break;
      }
      case VoiceType.Sampling:
        return PxtnErr.FMT_UNKNOWN;
      default:
        return PxtnErr.PTV_NO_SUPPORTED;
    }
    return PxtnErr.OK;
  }

  private readEnvelope(io: MemoryIo, vc: VoiceUnit): PxtnErr {
    const enve = vc.envelope;
    const fps = dataReadV(io);
    if (fps === null) return PxtnErr.DESC_R;
    enve.fps = fps;
    const headNum = dataReadV(io);
    if (headNum === null) return PxtnErr.DESC_R;
    enve.headNum = headNum;
    const bodyNum = dataReadV(io);
    if (bodyNum === null) return PxtnErr.DESC_R;
    enve.bodyNum = bodyNum;
    const tailNum = dataReadV(io);
    if (tailNum === null) return PxtnErr.DESC_R;
    enve.tailNum = tailNum;
    if (enve.bodyNum) return PxtnErr.FMT_UNKNOWN;
    if (enve.tailNum !== 1) return PxtnErr.FMT_UNKNOWN;
    enve.points = [];
    const num = enve.headNum + enve.bodyNum + enve.tailNum;
    for (let i = 0; i < num; i++) {
      const x = dataReadV(io);
      if (x === null) return PxtnErr.DESC_R;
      const y = dataReadV(io);
      if (y === null) return PxtnErr.DESC_R;
      enve.points.push({ x, y });
    }
    return PxtnErr.OK;
  }

  // ---- matePCM / matePTN / matePTV ----

  ioMatePcmW(io: MemoryIo): boolean {
    const vc = this._voices[0]!;
    const pcm = vc.pcm;
    const size = 24 + pcm.bufSize;
    ioPutUint32LE(io, size);
    ioPutU16LE(io, 0); // x3x_unit_no
    ioPutU16LE(io, vc.basicKey & 0xffff);
    ioPutUint32LE(io, vc.voiceFlags);
    ioPutU16LE(io, pcm.ch & 0xffff);
    ioPutU16LE(io, pcm.bps & 0xffff);
    ioPutUint32LE(io, pcm.sps);
    ioPutFloatLE(io, vc.tuning);
    ioPutUint32LE(io, pcm.bufSize);
    if (!pcm.pBuf) return false;
    io.write(pcm.pBuf, 1, pcm.bufSize);
    return true;
  }

  ioMatePcmR(io: MemoryIo): PxtnErr {
    const size = ioGetUint32LE(io);
    if (size === null) return PxtnErr.DESC_R;
    void size;
    const unitNo = ioGetUint16LE(io);
    if (unitNo === null) return PxtnErr.DESC_R;
    void unitNo;
    const basicKey = ioGetUint16LE(io);
    if (basicKey === null) return PxtnErr.DESC_R;
    const voiceFlags = ioGetUint32LE(io);
    if (voiceFlags === null) return PxtnErr.DESC_R;
    if (voiceFlags & PTV_VOICEFLAG_UNCOVERED) return PxtnErr.FMT_UNKNOWN;
    const ch = ioGetUint16LE(io);
    if (ch === null) return PxtnErr.DESC_R;
    const bps = ioGetUint16LE(io);
    if (bps === null) return PxtnErr.DESC_R;
    const sps = ioGetUint32LE(io);
    if (sps === null) return PxtnErr.DESC_R;
    const tuning = ioGetFloatLE(io);
    if (tuning === null) return PxtnErr.DESC_R;
    const dataSize = ioGetUint32LE(io);
    if (dataSize === null) return PxtnErr.DESC_R;

    if (!this.voiceAllocate(1)) return PxtnErr.MEMORY;
    const vc = this._voices[0]!;
    vc.type = VoiceType.Sampling;
    const res = vc.pcm.create(ch, sps, bps, Math.trunc(dataSize / ((bps / 8) * ch)));
    if (res !== PxtnErr.OK) return res;
    const buf = ioGetBytes(io, dataSize);
    if (buf === null) {
      this.voiceRelease();
      return PxtnErr.DESC_R;
    }
    vc.pcm.pBuf!.set(buf);
    this._type = WoiceType.PCM;
    vc.voiceFlags = voiceFlags;
    vc.basicKey = basicKey;
    vc.tuning = tuning;
    this._x3xBasicKey = basicKey;
    // x3x 形式の整合用フィールド: PCM ボイスにはチューニング情報がないため 0 を保持する
    this._x3xTuning = 0;
    return PxtnErr.OK;
  }

  ioMatePtnW(io: MemoryIo): boolean {
    const vc = this._voices[0]!;
    const start = io.position;
    ioPutInt32LE(io, 0); // size placeholder
    ioPutU16LE(io, 0); // x3x_unit_no
    ioPutU16LE(io, vc.basicKey & 0xffff);
    ioPutUint32LE(io, vc.voiceFlags);
    ioPutFloatLE(io, vc.tuning);
    ioPutInt32LE(io, 1); // rrr
    let size = 16;
    if (!vc.ptn.write(io, io.position)) return false;
    size += io.position - (start + 20);
    const end = io.position;
    if (!io.seek(SEEK_CUR, start - end)) return false;
    ioPutInt32LE(io, size);
    return io.seek(SEEK_CUR, end - io.position);
  }

  ioMatePtnR(io: MemoryIo): PxtnErr {
    const size = ioGetUint32LE(io);
    if (size === null) return PxtnErr.DESC_R;
    void size;
    const unitNo = ioGetUint16LE(io);
    if (unitNo === null) return PxtnErr.DESC_R;
    void unitNo;
    const basicKey = ioGetUint16LE(io);
    if (basicKey === null) return PxtnErr.DESC_R;
    const voiceFlags = ioGetUint32LE(io);
    if (voiceFlags === null) return PxtnErr.DESC_R;
    const tuning = ioGetFloatLE(io);
    if (tuning === null) return PxtnErr.DESC_R;
    const rrr = ioGetInt32LE(io);
    if (rrr === null) return PxtnErr.DESC_R;
    if (rrr > 1 || rrr < 0) return PxtnErr.FMT_UNKNOWN;
    if (!this.voiceAllocate(1)) return PxtnErr.MEMORY;
    const vc = this._voices[0]!;
    vc.type = VoiceType.Noise;
    const res = vc.ptn.read(io);
    if (res !== PxtnErr.OK) {
      this.voiceRelease();
      return res;
    }
    this._type = WoiceType.PTN;
    vc.voiceFlags = voiceFlags;
    vc.basicKey = basicKey;
    vc.tuning = tuning;
    this._x3xBasicKey = basicKey;
    this._x3xTuning = 0;
    return PxtnErr.OK;
  }

  ioMatePtvW(io: MemoryIo): boolean {
    const start = io.position;
    ioPutInt32LE(io, 0); // size placeholder
    ioPutU16LE(io, 0); // x3x_unit_no
    ioPutU16LE(io, 0); // rrr
    ioPutFloatLE(io, 0); // x3x_tuning
    ioPutInt32LE(io, 0); // ptv.size
    const ptvSize = this.ptvWrite(io);
    if (ptvSize < 0) return false;
    const end = io.position;
    if (!io.seek(SEEK_CUR, start - end)) return false;
    ioPutInt32LE(io, ptvSize + 12);
    ioPutU16LE(io, 0);
    ioPutU16LE(io, 0);
    ioPutFloatLE(io, 0);
    ioPutInt32LE(io, ptvSize);
    return io.seek(SEEK_CUR, end - io.position);
  }

  ioMatePtvR(io: MemoryIo): PxtnErr {
    const size = ioGetInt32LE(io);
    if (size === null) return PxtnErr.DESC_R;
    void size;
    const unitNo = ioGetUint16LE(io);
    if (unitNo === null) return PxtnErr.DESC_R;
    void unitNo;
    const rrr = ioGetUint16LE(io);
    if (rrr === null) return PxtnErr.DESC_R;
    const x3xTuning = ioGetFloatLE(io);
    if (x3xTuning === null) return PxtnErr.DESC_R;
    const ptvSize = ioGetInt32LE(io);
    if (ptvSize === null) return PxtnErr.DESC_R;
    void ptvSize;
    if (rrr) return PxtnErr.FMT_UNKNOWN;
    const res = this.ptvRead(io);
    if (res !== PxtnErr.OK) return res;
    if (x3xTuning !== 1.0) this._x3xTuning = x3xTuning;
    else this._x3xTuning = 0;
    return PxtnErr.OK;
  }

  // ---- OGGV ----

  // 12byte mate (xxx/basic_key/voice_flags/tuning) + 16byte pxtn ヘッダ (ch/sps/smp_num/size) + 生 ogg
  ioMateOggvW(io: MemoryIo): boolean {
    const vc = this._voices[0]!;
    if (!vc.oggv) return false;
    const oggvSize = 16 + vc.oggv.data.length;
    ioPutUint32LE(io, 12 + oggvSize);
    ioPutU16LE(io, 0); // xxx (ch のダミー)
    ioPutU16LE(io, vc.basicKey & 0xffff);
    ioPutUint32LE(io, vc.voiceFlags);
    ioPutFloatLE(io, vc.tuning);
    ioPutInt32LE(io, vc.oggv.ch);
    ioPutInt32LE(io, vc.oggv.sps);
    ioPutInt32LE(io, vc.oggv.smpNum);
    ioPutInt32LE(io, vc.oggv.data.length);
    io.write(vc.oggv.data, 1, vc.oggv.data.length);
    return true;
  }

  ioMateOggvR(io: MemoryIo): PxtnErr {
    const size = ioGetUint32LE(io);
    if (size === null) return PxtnErr.DESC_R;
    void size;
    const xxx = ioGetUint16LE(io);
    if (xxx === null) return PxtnErr.DESC_R;
    void xxx;
    const basicKey = ioGetUint16LE(io);
    if (basicKey === null) return PxtnErr.DESC_R;
    const voiceFlags = ioGetUint32LE(io);
    if (voiceFlags === null) return PxtnErr.DESC_R;
    if (voiceFlags & PTV_VOICEFLAG_UNCOVERED) return PxtnErr.FMT_UNKNOWN;
    const tuning = ioGetFloatLE(io);
    if (tuning === null) return PxtnErr.DESC_R;
    const ch = ioGetInt32LE(io);
    const sps = ioGetInt32LE(io);
    const smpNum = ioGetInt32LE(io);
    const dataSize = ioGetInt32LE(io);
    if (ch === null || sps === null || smpNum === null || dataSize === null) return PxtnErr.DESC_R;
    if (dataSize < 0) return PxtnErr.FMT_UNKNOWN;
    const data = ioGetBytes(io, dataSize);
    if (data === null) return PxtnErr.DESC_R;
    if (!this.voiceAllocate(1)) return PxtnErr.MEMORY;
    const vc = this._voices[0]!;
    vc.type = VoiceType.OggVorbis;
    vc.oggv = { ch, sps, smpNum, data };
    vc.oggvDecoded = false;
    vc.voiceFlags = voiceFlags;
    vc.basicKey = basicKey;
    vc.tuning = tuning;
    this._type = WoiceType.OGGV;
    this._x3xBasicKey = basicKey;
    this._x3xTuning = 0;
    return PxtnErr.OK;
  }

  // OGGV が PCM 化済みか
  isOggvDecoded(): boolean {
    const vc = this._voices[0];
    return vc ? vc.oggvDecoded : false;
  }

  // 生 ogg をデコードして vc.pcm (16bit PCM) に格納する
  async decodeOggv(decoder: OggvDecoder): Promise<PxtnErr> {
    if (this._voiceNum < 1) return PxtnErr.PARAM;
    const vc = this._voices[0]!;
    if (vc.type !== VoiceType.OggVorbis || !vc.oggv) return PxtnErr.OGG;
    let decoded: OggvDecoded;
    try {
      decoded = await decoder.decode(vc.oggv.data);
    } catch {
      return PxtnErr.OGG;
    }
    if (decoded.ch < 1 || decoded.samples.length < 1) return PxtnErr.OGG;
    const smpNum = decoded.samples[0]!.length;
    if (!smpNum) return PxtnErr.OGG;
    const pcm = new Pcm();
    const res = pcm.create(decoded.ch, decoded.sps, 16, smpNum);
    if (res !== PxtnErr.OK) return res;
    const dv = new DataView(pcm.pBuf!.buffer, pcm.pBuf!.byteOffset, pcm.pBuf!.byteLength);
    for (let i = 0; i < smpNum; i++) {
      for (let c = 0; c < decoded.ch; c++) {
        const s = decoded.samples[c]![i]!;
        const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
        dv.setInt16((i * decoded.ch + c) * 2, Math.trunc(clamped * 32767), true);
      }
    }
    vc.pcm = pcm;
    vc.oggvDecoded = true;
    return PxtnErr.OK;
  }
}