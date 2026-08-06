// pxtnData 相当: シーク可能なメモリI/O + 可変長整数(varint)
//
// C++ の pxtnData は4関数ポインタ（read/write/seek/pos）を注入する設計だが、
// 実質的にメモリバッファを指すだけで、OS・デバイス非依存のため
// ここではシーク可能な可変長バッファ（MemoryIo）として実装する。

export const SEEK_SET = 0;
export const SEEK_CUR = 1;
export const SEEK_END = 2;

const GROW_BASE = 1024;

function growCapacity(cap: number, needed: number): number {
  let c = cap;
  while (c < needed) c += Math.max(GROW_BASE, c >> 1);
  return c;
}

export class MemoryIo {
  private buf: Uint8Array;
  private _len = 0;
  private _pos = 0;

  constructor(data?: ArrayBuffer | Uint8Array | number) {
    if (typeof data === "number") {
      this.buf = new Uint8Array(Math.max(data, GROW_BASE));
      this._len = 0;
    } else if (data instanceof ArrayBuffer) {
      this.buf = new Uint8Array(data.byteLength);
      this.buf.set(new Uint8Array(data));
      this._len = data.byteLength;
    } else if (data instanceof Uint8Array) {
      this.buf = new Uint8Array(data.length);
      this.buf.set(data);
      this._len = data.length;
    } else {
      this.buf = new Uint8Array(GROW_BASE);
      this._len = 0;
    }
  }

  get position(): number {
    return this._pos;
  }

  get size(): number {
    return this._len;
  }

  get remain(): number {
    return this._len - this._pos;
  }

  read(dst: Uint8Array, size: number, num: number): boolean {
    const total = size * num;
    if (total === 0) return true;
    if (this._pos + total > this._len) return false;
    dst.set(this.buf.subarray(this._pos, this._pos + total));
    this._pos += total;
    return true;
  }

  write(src: Uint8Array, size: number, num: number): boolean {
    const total = size * num;
    if (total === 0) return true;
    this.ensure(this._pos + total);
    const dst = this.buf.subarray(this._pos, this._pos + total);
    dst.set(src.subarray(0, total));
    this._pos += total;
    if (this._pos > this._len) this._len = this._pos;
    return true;
  }

  // mode に応じて offset へ移動する (SEEK_SET: 先頭から / SEEK_CUR: 現在位置から / SEEK_END: 末尾から)
  seek(mode: number, offset: number): boolean {
    if (mode === SEEK_SET) {
      if (offset < 0) return false;
      this._pos = offset;
    } else if (mode === SEEK_CUR) {
      if (this._pos + offset < 0) return false;
      this._pos += offset;
    } else if (mode === SEEK_END) {
      if (this._len + offset < 0) return false;
      this._pos = this._len + offset;
    } else {
      return false;
    }
    return true;
  }

  clear(): void {
    this._pos = 0;
    this._len = 0;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this._len);
  }

  private ensure(needed: number): void {
    if (needed <= this.buf.length) return;
    const grown = growCapacity(this.buf.length, needed);
    const nb = new Uint8Array(grown);
    nb.set(this.buf.subarray(0, this._len));
    this.buf = nb;
  }
}

// ---- 型付き読み書き（リトルエンディアン） ----
// スクラッチ領域を再利用して、呼び出し毎のアロケーションを避ける
// (float 変換のみ DataView を都度確保する)

export function ioGetU8(io: MemoryIo): number | null {
  return io.read(scratch1, 1, 1) ? scratch1[0]! : null;
}

export function ioPutU8(io: MemoryIo, v: number): void {
  scratch1[0] = v & 0xff;
  io.write(scratch1, 1, 1);
}

export function ioGetInt8(io: MemoryIo): number | null {
  const v = ioGetU8(io);
  return v === null ? null : (v << 24) >> 24;
}

export function ioGetU16LE(io: MemoryIo): number | null {
  if (!io.read(scratch2, 1, 2)) return null;
  return scratch2[0]! | (scratch2[1]! << 8);
}
export const ioGetUint16LE = ioGetU16LE;

export function ioPutU16LE(io: MemoryIo, v: number): void {
  scratch2[0] = v & 0xff;
  scratch2[1] = (v >>> 8) & 0xff;
  io.write(scratch2, 1, 2);
}
export const ioPutUint16LE = ioPutU16LE;

export function ioGetInt16LE(io: MemoryIo): number | null {
  const v = ioGetU16LE(io);
  return v === null ? null : (v << 16) >> 16;
}

export function ioPutInt16LE(io: MemoryIo, v: number): void {
  ioPutU16LE(io, v);
}

export function ioGetInt32LE(io: MemoryIo): number | null {
  if (!io.read(scratch4, 1, 4)) return null;
  return scratch4[0]! | (scratch4[1]! << 8) | (scratch4[2]! << 16) | (scratch4[3]! << 24);
}

export function ioPutInt32LE(io: MemoryIo, v: number): void {
  writeI32LE(scratch4, v);
  io.write(scratch4, 1, 4);
}

export function ioPutUint32LE(io: MemoryIo, v: number): void {
  ioPutInt32LE(io, v >>> 0);
}

export function ioPutInt8(io: MemoryIo, v: number): void {
  ioPutU8(io, (v << 24) >> 24);
}

// float32 のビット列を int32 として扱う（C++ の memcpy 相当）
export function floatToInt32Bits(v: number): number {
  const dv = new DataView(asInt8Array(4).buffer);
  dv.setFloat32(0, v, true);
  return dv.getInt32(0, true);
}
export function int32ToFloat(bits: number): number {
  const dv = new DataView(asInt8Array(4).buffer);
  dv.setInt32(0, bits, true);
  return dv.getFloat32(0, true);
}

function asInt8Array(n: number): Int8Array {
  return new Int8Array(n);
}

export function ioGetUint32LE(io: MemoryIo): number | null {
  const v = ioGetInt32LE(io);
  return v === null ? null : v >>> 0;
}

export function ioGetFloatLE(io: MemoryIo): number | null {
  if (!io.read(scratch4, 1, 4)) return null;
  return floatView.getFloat32(0, true);
}

export function ioPutFloatLE(io: MemoryIo, v: number): void {
  floatView.setFloat32(0, v, true);
  io.write(scratch4, 1, 4);
}

export function ioGetBytes(io: MemoryIo, n: number): Uint8Array | null {
  if (io.remain < n) return null;
  const out = new Uint8Array(n);
  io.read(out, 1, n);
  return out;
}

export function ioGetAsciiString(io: MemoryIo, n: number): string | null {
  const b = ioGetBytes(io, n);
  if (!b) return null;
  return asciiBytesToString(b);
}

// NUL 終端を解釈しない ASCII 読み取り (ファイル識別コード等の厳密一致用)
export function ioGetAsciiExact(io: MemoryIo, n: number): string | null {
  const b = ioGetBytes(io, n);
  if (b === null) return null;
  let s = "";
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

// ASCII 文字列 <-> バイト列 (SJIS/UTF-8 エンコードは行わない)
export function stringToAsciiBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export function ioPutAsciiString(io: MemoryIo, s: string): boolean {
  return io.write(stringToAsciiBytes(s), 1, s.length);
}

// NUL 終端の ASCII バイト列を文字列へ (ファイル形式の名前・タグ用)
export function asciiBytesToString(b: Uint8Array): string {
  let s = "";
  for (const c of b) {
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// ---- varint（pxtnData.cpp の _int_to_v / _v_to_int / _data_check_v_size 相当） ----
// i は int32 のビット列を uint32 として扱う。decode は int32 として復元する。

export function intToVBytes(i32: number): number[] {
  const u = i32 >>> 0;
  const a = [(u >>> 0) & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff, 0];
  if (u < 0x80) {
    return [a[0]!, 0, 0, 0, 0];
  } else if (u < 0x4000) {
    return [
      (a[0]! & 0x7f) | 0x80,
      (a[0]! >> 7) | ((a[1]! << 1) & 0x7f),
      0,
      0,
      0,
    ];
  } else if (u < 0x200000) {
    return [
      (a[0]! & 0x7f) | 0x80,
      ((a[0]! >> 7) | (a[1]! << 1)) & 0x7f | 0x80,
      (a[1]! >> 6) | ((a[2]! << 2) & 0x7f),
      0,
      0,
    ];
  } else if (u < 0x10000000) {
    return [
      (a[0]! & 0x7f) | 0x80,
      ((a[0]! >> 7) | (a[1]! << 1)) & 0x7f | 0x80,
      ((a[1]! >> 6) | (a[2]! << 2)) & 0x7f | 0x80,
      (a[2]! >> 5) | ((a[3]! << 3) & 0x7f),
      0,
    ];
  }
  return [
    (a[0]! & 0x7f) | 0x80,
    ((a[0]! >> 7) | (a[1]! << 1)) & 0x7f | 0x80,
    ((a[1]! >> 6) | (a[2]! << 2)) & 0x7f | 0x80,
    ((a[2]! >> 5) | (a[3]! << 3)) & 0x7f | 0x80,
    (a[3]! >> 4) | ((a[4]! << 4) & 0x7f),
  ];
}

function vToInt(bytes: readonly number[], byteNum: number): number {
  const b = [0, 0, 0, 0, 0];
  switch (byteNum) {
    case 0:
      break;
    case 1:
      b[0] = (bytes[0]! & 0x7f) & 0xff;
      break;
    case 2:
      b[0] = (bytes[0]! & 0x7f | (bytes[1]! << 7)) & 0xff;
      b[1] = ((bytes[1]! & 0x7f) >> 1) & 0xff;
      break;
    case 3:
      b[0] = (bytes[0]! & 0x7f | (bytes[1]! << 7)) & 0xff;
      b[1] = (((bytes[1]! & 0x7f) >> 1) | (bytes[2]! << 6)) & 0xff;
      b[2] = ((bytes[2]! & 0x7f) >> 2) & 0xff;
      break;
    case 4:
      b[0] = (bytes[0]! & 0x7f | (bytes[1]! << 7)) & 0xff;
      b[1] = (((bytes[1]! & 0x7f) >> 1) | (bytes[2]! << 6)) & 0xff;
      b[2] = (((bytes[2]! & 0x7f) >> 2) | (bytes[3]! << 5)) & 0xff;
      b[3] = ((bytes[3]! & 0x7f) >> 3) & 0xff;
      break;
    case 5:
      b[0] = (bytes[0]! & 0x7f | (bytes[1]! << 7)) & 0xff;
      b[1] = (((bytes[1]! & 0x7f) >> 1) | (bytes[2]! << 6)) & 0xff;
      b[2] = (((bytes[2]! & 0x7f) >> 2) | (bytes[3]! << 5)) & 0xff;
      b[3] = (((bytes[3]! & 0x7f) >> 3) | (bytes[4]! << 4)) & 0xff;
      b[4] = ((bytes[4]! & 0x7f) >> 4) & 0xff;
      break;
    default:
      throw new RangeError("varint: invalid byte_num=" + byteNum);
  }
  return b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
}

export function dataCheckVSize(v: number): number {
  const u = v >>> 0;
  if (u < 0x80) return 1;
  if (u < 0x4000) return 2;
  if (u < 0x200000) return 3;
  if (u < 0x10000000) return 4;
  return 5;
}

export function dataWriteV(io: MemoryIo, v: number): boolean {
  const bytes = intToVBytes(v);
  const n = dataCheckVSize(v);
  const tmp = theVBytes;
  for (let i = 0; i < n; i++) tmp[i] = bytes[i]!;
  io.write(tmp.subarray(0, n), 1, n);
  return true;
}

export function dataReadV(io: MemoryIo): number | null {
  const a = [0, 0, 0, 0, 0];
  let count = 0;
  for (; count < 5; count++) {
    const b = ioGetU8(io);
    if (b === null) return null;
    a[count] = b;
    if ((b & 0x80) === 0) break;
  }
  return vToInt(a, count + 1);
}

// ---- スクラッチ領域 ----
const scratch1 = new Uint8Array(1);
const scratch2 = new Uint8Array(2);
const scratch4 = new Uint8Array(4);
const floatView = new DataView(scratch4.buffer);
const theVBytes = new Uint8Array(5);

function writeI32LE(dst: Uint8Array, v: number): void {
  dst[0] = v & 0xff;
  dst[1] = (v >>> 8) & 0xff;
  dst[2] = (v >>> 16) & 0xff;
  dst[3] = (v >>> 24) & 0xff;
}