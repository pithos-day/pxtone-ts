// pxtnText 相当（曲名・コメント）。バイト列として保持する（SJIS のまま）。
// 文字列へは TextDecoder("shift_jis") で変換可能。

import type { MemoryIo } from "./data.js";
import { ioGetBytes, ioGetInt32LE, ioPutInt32LE } from "./data.js";

export class PxtnText {
  private _comment = new Uint8Array(0);
  private _name = new Uint8Array(0);

  get hasComment(): boolean {
    return this._comment.length > 0;
  }
  get hasName(): boolean {
    return this._name.length > 0;
  }

  setCommentBuf(buf: Uint8Array): boolean {
    this._comment = new Uint8Array(buf.length);
    this._comment.set(buf);
    return true;
  }

  setNameBuf(buf: Uint8Array): boolean {
    this._name = new Uint8Array(buf.length);
    this._name.set(buf);
    return true;
  }

  getCommentBuf(): Uint8Array {
    return this._comment;
  }

  getNameBuf(): Uint8Array {
    return this._name;
  }

  // 文字列として取得（SJIS→Unicode）
  getCommentString(): string {
    return shiftJisToString(this._comment);
  }

  getNameString(): string {
    return shiftJisToString(this._name);
  }

  commentW(desc: MemoryIo): boolean {
    if (!this.hasComment) return false;
    return write4(desc, this._comment);
  }

  nameW(desc: MemoryIo): boolean {
    if (!this.hasName) return false;
    return write4(desc, this._name);
  }

  commentR(desc: MemoryIo): boolean {
    const r = read4(desc);
    if (r === null) return false;
    this._comment = new Uint8Array(r.length);
    this._comment.set(r);
    return true;
  }

  nameR(desc: MemoryIo): boolean {
    const r = read4(desc);
    if (r === null) return false;
    this._name = new Uint8Array(r.length);
    this._name.set(r);
    return true;
  }
}

function read4(desc: MemoryIo): Uint8Array | null {
  const size = ioGetInt32LE(desc);
  if (size === null || size < 0) return null;
  if (size === 0) return new Uint8Array(0);
  const b = ioGetBytes(desc, size);
  return b;
}

function write4(desc: MemoryIo, buf: Uint8Array): boolean {
  ioPutInt32LE(desc, buf.length);
  desc.write(buf, 1, buf.length);
  return true;
}

// 遅延生成 (AudioWorkletGlobalScope には TextDecoder が存在しないため、
// 必要な時だけ生成する)
let sjisDecoder: TextDecoder | null = null;

export function shiftJisToString(buf: Uint8Array): string {
  if (!sjisDecoder) sjisDecoder = new TextDecoder("shift_jis");
  return sjisDecoder.decode(buf);
}

// 文字列をバイト列へエンコードする。Web/Node 標準の TextEncoder は UTF-8 のみのため、
// SJIS 互換ではなく UTF-8 バイト列を返す (曲名・コメントのバイト列編集起点として round-trip 互換)。
// 旧名 encodeShiftJis は互換のための alias。
export function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** @deprecated encodeUtf8 に改名。SJIS ではなく UTF-8 を返す点に注意 */
export const encodeShiftJis = encodeUtf8;