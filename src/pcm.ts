// pxtnPulse_PCM.cpp 相当（WAV/PCM 読み書き・変換）

import { PxtnErr } from "./error.js";
import { MemoryIo, SEEK_CUR, SEEK_SET, ioGetBytes, ioGetU16LE, ioGetUint16LE, ioGetUint32LE, ioPutAsciiString, ioPutU16LE, ioPutUint32LE } from "./data.js";

const _CHUNK_HEADER = 16;

export class Pcm {
  private _pSmp: Uint8Array | null = null;
  private _ch = 0;
  private _sps = 0;
  private _bps = 0;
  private _smpHead = 0;
  private _smpBody = 0;
  private _smpTail = 0;

  release(): void {
    this._pSmp = null;
    this._ch = 0;
    this._sps = 0;
    this._bps = 0;
    this._smpHead = 0;
    this._smpBody = 0;
    this._smpTail = 0;
  }

  devolveSamplingBuffer(): Uint8Array | null {
    const p = this._pSmp;
    this._pSmp = null;
    return p;
  }

  create(ch: number, sps: number, bps: number, sampleNum: number): PxtnErr {
    this.release();
    if (bps !== 8 && bps !== 16) return PxtnErr.PCM_UNKNOWN;
    this._ch = ch;
    this._sps = sps;
    this._bps = bps;
    this._smpHead = 0;
    this._smpBody = sampleNum;
    this._smpTail = 0;
    const size = (this._smpBody * this._bps * this._ch) / 8;
    this._pSmp = new Uint8Array(size);
    if (bps === 8) this._pSmp.fill(128);
    return PxtnErr.OK;
  }

  read(io: MemoryIo): PxtnErr {
    this._pSmp = null;
    const head = ioGetBytes(io, _CHUNK_HEADER);
    if (head === null) return PxtnErr.DESC_R;
    const isRIFF =
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
    const isWAVE =
      head[8] === 0x57 && head[9] === 0x41 && head[10] === 0x56 && head[11] === 0x45;
    const isFMTSpace =
      head[12] === 0x66 && head[13] === 0x6d && head[14] === 0x74 && head[15] === 0x20;
    if (!isRIFF || !isWAVE || !isFMTSpace) return PxtnErr.PCM_UNKNOWN;

    ioGetUint32LE(io); // fmt チャンクサイズ
    const formatID = ioGetU16LE(io);
    const ch = ioGetU16LE(io);
    const sps = ioGetUint32LE(io);
    ioGetUint32LE(io); // bytePerSec
    ioGetU16LE(io); // blockSize
    const bps = ioGetU16LE(io);
    const fmtTail = ioGetU16LE(io); // ext
    if (formatID === null || ch === null || sps === null || bps === null || fmtTail === null)
      return PxtnErr.DESC_R;

    if (formatID !== 0x0001) return PxtnErr.PCM_UNKNOWN;
    if (ch !== 1 && ch !== 2) return PxtnErr.PCM_UNKNOWN;
    if (bps !== 8 && bps !== 16) return PxtnErr.PCM_UNKNOWN;

    if (!io.seek(SEEK_SET, 12)) return PxtnErr.DESC_R;
    const tag = new Uint8Array(4);
    let dataSize = 0;
    for (;;) {
      if (!io.read(tag, 1, 4)) return PxtnErr.DESC_R;
      const size = ioGetUint32LE(io);
      if (size === null) return PxtnErr.DESC_R;
      if (tag[0] === 0x64 && tag[1] === 0x61 && tag[2] === 0x74 && tag[3] === 0x61) {
        // 'data'
        dataSize = size;
        break;
      }
      if (!io.seek(SEEK_CUR, size)) return PxtnErr.DESC_R;
    }
    const res = this.create(ch, sps, bps, Math.trunc((dataSize * 8) / bps / ch));
    if (res !== PxtnErr.OK) return res;
    const samples = ioGetBytes(io, dataSize);
    if (samples === null) {
      this._pSmp = null;
      return PxtnErr.DESC_R;
    }
    this._pSmp = samples;
    return PxtnErr.OK;
  }

  write(io: MemoryIo, pstrLIST?: string): boolean {
    if (!this._pSmp) return false;
    const sampleSize = this.totalByteSize;
    const bText = !!pstrLIST && pstrLIST.length > 0;
    let isftSize = 0;
    let listSize = 0;
    let riffSize = sampleSize + 4 + 26 + 12 + 8;
    if (bText) {
      isftSize = pstrLIST!.length;
      listSize = 4 + 4 + 4 + isftSize;
      riffSize += 8 + listSize;
    }
    ioPutAsciiString(io, "RIFF");
    ioPutUint32LE(io, riffSize);
    ioPutAsciiString(io, "WAVE");
    ioPutAsciiString(io, "fmt ");
    ioPutUint32LE(io, 0x12);
    ioPutU16LE(io, 0x0001);
    ioPutU16LE(io, this._ch);
    ioPutUint32LE(io, this._sps);
    ioPutUint32LE(io, (this._sps * this._bps * this._ch) / 8);
    ioPutU16LE(io, (this._bps * this._ch) / 8);
    ioPutU16LE(io, this._bps);
    ioPutU16LE(io, 0);
    if (bText) {
      ioPutAsciiString(io, "LIST");
      ioPutUint32LE(io, listSize);
      ioPutAsciiString(io, "INFO");
      ioPutAsciiString(io, "ISFT");
      ioPutUint32LE(io, isftSize);
      ioPutAsciiString(io, pstrLIST!);
    }
    ioPutAsciiString(io, "fact");
    ioPutUint32LE(io, 0x04);
    ioPutUint32LE(io, this._smpHead + this._smpBody + this._smpTail);
    ioPutAsciiString(io, "data");
    ioPutUint32LE(io, sampleSize);
    io.write(this._pSmp, 1, sampleSize);
    return true;
  }

  convertChannelNum(newCh: number): boolean {
    if (!this._pSmp) return false;
    if (this._ch === newCh) return true;
    const sampleSize = this.totalByteSize;
    const src = this._pSmp;
    let work: Uint8Array;
    if (newCh === 2) {
      work = new Uint8Array(sampleSize * 2);
      if (this._bps === 8) {
        for (let a = 0, b = 0; a < sampleSize; a++, b += 2) {
          work[b] = src[a]!;
          work[b + 1] = src[a]!;
        }
      } else {
        for (let a = 0, b = 0; a < sampleSize; a += 2, b += 4) {
          work[b] = src[a]!;
          work[b + 1] = src[a + 1]!;
          work[b + 2] = src[a]!;
          work[b + 3] = src[a + 1]!;
        }
      }
    } else {
      work = new Uint8Array(sampleSize / 2);
      if (this._bps === 8) {
        for (let a = 0, b = 0; a < sampleSize; a += 2, b++) {
          work[b] = (src[a]! + src[a + 1]!) >> 1;
        }
      } else {
        for (let a = 0, b = 0; a < sampleSize; a += 4, b += 2) {
          const temp1 = i16At(src, a);
          const temp2 = i16At(src, a + 2);
          putI16(work, b, ((temp1 + temp2) / 2) | 0);
        }
      }
    }
    this._pSmp = work;
    this._ch = newCh;
    return true;
  }

  convertBitPerSample(newBps: number): boolean {
    if (!this._pSmp) return false;
    if (this._bps === newBps) return true;
    const sampleSize = this.totalByteSize;
    const src = this._pSmp;
    let work: Uint8Array;
    if (newBps === 8) {
      work = new Uint8Array(sampleSize / 2);
      for (let a = 0, b = 0; a < sampleSize; a += 2, b++) {
        let temp1 = i16At(src, a);
        temp1 = (temp1 / 0x100) + 128;
        work[b] = temp1 & 0xff;
      }
    } else if (newBps === 16) {
      work = new Uint8Array(sampleSize * 2);
      for (let a = 0, b = 0; a < sampleSize; a++, b += 2) {
        const temp1 = (((src[a]! - 128) * 0x100) << 16) >> 16;
        putI16(work, b, temp1);
      }
    } else {
      return false;
    }
    this._pSmp = work;
    this._bps = newBps;
    return true;
  }

  convertSamplePerSecond(newSps: number): boolean {
    if (!this._pSmp) return false;
    if (this._sps === newSps) return true;
    const src = this._pSmp;
    let head = this.sampleByteSizeFrom(this._smpHead);
    let body = this.sampleByteSizeFrom(this._smpBody);
    let tail = this.sampleByteSizeFrom(this._smpTail);
    head = Math.trunc(((head * newSps) + this._sps - 1) / this._sps);
    body = Math.trunc(((body * newSps) + this._sps - 1) / this._sps);
    tail = Math.trunc(((tail * newSps) + this._sps - 1) / this._sps);
    const workSize = head + body + tail;

    if (this._ch === 2 && this._bps === 16) {
      this._smpHead = head / 4;
      this._smpBody = body / 4;
      this._smpTail = tail / 4;
      const sampleNum = Math.trunc(workSize / 4);
      const size = sampleNum * 4;
      const work = new Uint8Array(size);
      const srcU32 = u32View(src);
      const workU32 = u32View(work);
      for (let a = 0; a < sampleNum; a++) {
        const b = Math.trunc((a * this._sps) / newSps);
        workU32[a] = srcU32[b]!;
      }
      this._pSmp = work;
    } else if (this._ch === 1 && this._bps === 8) {
      this._smpHead = head;
      this._smpBody = body;
      this._smpTail = tail;
      const sampleNum = workSize;
      const work = new Uint8Array(sampleNum);
      for (let a = 0; a < sampleNum; a++) {
        work[a] = src[Math.trunc((a * this._sps) / newSps)]!;
      }
      this._pSmp = work;
    } else {
      this._smpHead = head / 2;
      this._smpBody = body / 2;
      this._smpTail = tail / 2;
      const sampleNum = Math.trunc(workSize / 2);
      const size = sampleNum * 2;
      const work = new Uint8Array(size);
      const srcU16 = u16View(src);
      const workU16 = u16View(work);
      for (let a = 0; a < sampleNum; a++) {
        const b = Math.trunc((a * this._sps) / newSps);
        workU16[a] = srcU16[b]!;
      }
      this._pSmp = work;
    }
    this._sps = newSps;
    return true;
  }

  convert(newCh: number, newSps: number, newBps: number): boolean {
    if (!this.convertChannelNum(newCh)) return false;
    if (!this.convertBitPerSample(newBps)) return false;
    if (!this.convertSamplePerSecond(newSps)) return false;
    return true;
  }

  convertVolume(v: number): boolean {
    if (!this._pSmp) return false;
    const sampleNum = this.totalSampleNum;
    const p = this._pSmp;
    if (this._bps === 8) {
      for (let i = 0; i < sampleNum; i++) {
        p[i] = ((p[i]! - 128) * v + 128) & 0xff;
      }
    } else if (this._bps === 16) {
      const p16 = i16View(p);
      for (let i = 0; i < sampleNum; i++) {
        p16[i] = (p16[i]! * v) | 0;
      }
    } else {
      return false;
    }
    return true;
  }

  copyFrom(src: Pcm): boolean {
    if (!src._pSmp) {
      this.release();
      return true;
    }
    this.create(src._ch, src._sps, src._bps, src._smpBody);
    if (!this._pSmp) return false;
    this._pSmp.set(
      src._pSmp.subarray(
        0,
        ((src._smpHead + src._smpBody + src._smpTail) * src._ch * src._bps) / 8,
      ),
    );
    return true;
  }

  copyAt(start: number, end: number): Pcm | null {
    const dst = new Pcm();
    if (this._smpHead || this._smpTail) return null;
    if (!this._pSmp) {
      dst.release();
      return dst;
    }
    const size = ((end - start) * this._ch * this._bps) / 8;
    const offset = (start * this._ch * this._bps) / 8;
    if (dst.create(this._ch, this._sps, this._bps, end - start) !== PxtnErr.OK) return null;
    dst._pSmp!.set(this._pSmp.subarray(offset, offset + size));
    return dst;
  }

  private sampleByteSizeFrom(n: number): number {
    return (n * this._ch * this._bps) / 8;
  }

  get ch(): number {
    return this._ch;
  }
  get bps(): number {
    return this._bps;
  }
  get sps(): number {
    return this._sps;
  }
  get smpBody(): number {
    return this._smpBody;
  }
  get smpHead(): number {
    return this._smpHead;
  }
  get smpTail(): number {
    return this._smpTail;
  }
  get pBuf(): Uint8Array | null {
    return this._pSmp;
  }
  get sec(): number {
    return (this._smpBody + this._smpHead + this._smpTail) / this._sps;
  }
  get bufSize(): number {
    return this.totalByteSize;
  }
  // head/body/tail 全体のサンプル数 (チャンネル込み)
  get totalSampleNum(): number {
    return (this._smpHead + this._smpBody + this._smpTail) * this._ch;
  }
  // head/body/tail 全体のバイト数 (チャンネル・ビット深度込み)
  get totalByteSize(): number {
    return (this.totalSampleNum * this._bps) / 8;
  }
}

function putI16(dst: Uint8Array, off: number, v: number): void {
  dst[off] = v & 0xff;
  dst[off + 1] = (v >> 8) & 0xff;
}

// リトルエンディアン 2 バイトを int16 として読み、符号拡張する
export function i16At(b: Uint8Array, off: number): number {
  return (b[off]! | (b[off + 1]! << 8)) << 16 >> 16;
}

function u16View(b: Uint8Array): Uint16Array {
  return new Uint16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
}

function i16View(b: Uint8Array): Int16Array {
  return new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
}

function u32View(b: Uint8Array): Uint32Array {
  return new Uint32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
}