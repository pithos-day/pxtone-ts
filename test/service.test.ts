import { it, expect } from "vitest";
import { Service } from "../src/service.js";
import { MemoryIo, ioPutAsciiString, ioPutFloatLE, ioPutInt32LE, ioPutU16LE, ioPutU8 } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { WoiceType } from "../src/woice.js";
import { EventKind, EVENTDEFAULT_KEY } from "../src/event.js";
import { makePtvWoice } from "./helpers.js";

// V5 プロジェクトの先頭 (ファイル ID + exe バージョン + 予約領域) を書き込む
function putV5ProjectHeader(io: MemoryIo): void {
  ioPutAsciiString(io, "PTCOLLAGE-071119");
  ioPutU16LE(io, 0); // exe_ver
  ioPutU16LE(io, 0); // reserved
}

// 最小の MasterV5 チャンクを書き込む
function putMasterV5(io: MemoryIo, options: { beatClock?: number } = {}): void {
  ioPutAsciiString(io, "MasterV5");
  ioPutInt32LE(io, 15); // size
  ioPutU16LE(io, options.beatClock ?? 480); // beat_clock
  ioPutU8(io, 4); // beat_num
  ioPutFloatLE(io, 120.0); // beat_tempo
  ioPutInt32LE(io, 0); // clock_repeat
  ioPutInt32LE(io, 0); // clock_last
}

it("v5 project round trips through write/read", () => {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);

  s.master.setBeatClock(480);
  s.text.setNameBuf(new TextEncoder().encode("test song"));
  s.text.setCommentBuf(new TextEncoder().encode("comment here"));
  s.evels.recordAddI(0, 0, EventKind.ON, 4800);
  s.evels.recordAddI(0, 0, EventKind.KEY, EVENTDEFAULT_KEY);
  s.evels.recordAddI(240, 0, EventKind.VOLUME, 100);
  s.delayAdd(0, 0.5, 0.3, 0);
  s.overdriveAdd(90.0, 2.0, 0);
  const ioW = new MemoryIo();
  makePtvWoice().ptvWrite(ioW); // raw PTVOICE- blob
  ioW.seek(0, 0);
  expect(s.woiceRead(0, ioW, WoiceType.PTV)).toBe(PxtnErr.OK);
  s.unitAddNew();
  s.unitGet(0)!.setNameBuf("unit0");
  s.unitGet(0)!.setOperated(true);

  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);

  const s2 = new Service();
  expect(s2.initCollage(4096)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);

  expect(s2.text.getNameString()).toBe("test song");
  expect(s2.text.getCommentString()).toBe("comment here");
  expect(s2.master.beatClock).toBe(480);
  expect(s2.delayNum).toBe(1);
  expect(s2.overdriveNum).toBe(1);
  expect(s2.woiceNum).toBe(1);
  expect(s2.woiceGet(0)!.type).toBe(WoiceType.PTV);
  expect(s2.unitNum).toBe(1);
  expect(s2.unitGet(0)!.name).toBe("unit0");
  expect(s2.evels.count).toBe(3);
});

it("rejects unknown format version", () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  io.write(new Uint8Array(16).fill(0x41), 1, 16); // "AAAAAAAAAAAAAAAA"
  io.seek(0, 0);
  expect(s.read(io)).toBe(PxtnErr.FMT_UNKNOWN);
});

it("rejects anti operation tag", () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  putV5ProjectHeader(io);
  putMasterV5(io);
  ioPutAsciiString(io, "antiOPER");
  ioPutInt32LE(io, 0);
  ioPutAsciiString(io, "pxtoneND");
  ioPutInt32LE(io, 0);
  io.seek(0, 0);
  expect(s.read(io)).toBe(PxtnErr.ANTI_OPERATION);
});

// バイト列中に ASCII 文字列が現れるか (ファイルチャンクの存在確認用)
function includesAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

it("writes all-NUL assigned names back as assi chunks like C++", () => {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  const ioW = new MemoryIo();
  makePtvWoice().ptvWrite(ioW);
  ioW.seek(0, 0);
  expect(s.woiceRead(0, ioW, WoiceType.PTV)).toBe(PxtnErr.OK);
  s.unitAddNew();
  // 全 NUL の 16 バイト名。C++ は _name_size=16 を保持するためチャンクを再出力する
  s.woiceGet(0)!.setNameBuf(new Uint8Array(16), 16);
  s.unitGet(0)!.setNameBuf(new Uint8Array(16), 16);

  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);
  const bytes = io.toUint8Array();
  expect(includesAscii(bytes, "assiWOIC")).toBe(true);
  expect(includesAscii(bytes, "assiUNIT")).toBe(true);

  // 読み直しても割り当てサイズが残り、再書き出しでチャンクが消えない
  const s2 = new Service();
  expect(s2.initCollage(4096)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);
  expect(s2.woiceGet(0)!.isNameBuf()).toBe(true);
  expect(s2.unitGet(0)!.isNameBuf()).toBe(true);
  // 表示系 API は先頭 NUL までの長さのまま (getNameBuf/nameSize は変えない)
  expect(s2.woiceGet(0)!.nameSize).toBe(0);
  expect(s2.unitGet(0)!.name).toBe("");

  const io2 = new MemoryIo();
  expect(s2.write(io2, false, 0)).toBe(PxtnErr.OK);
  const bytes2 = io2.toUint8Array();
  expect(includesAscii(bytes2, "assiWOIC")).toBe(true);
  expect(includesAscii(bytes2, "assiUNIT")).toBe(true);
});

it("clears partially loaded data when read fails", () => {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  putV5ProjectHeader(io);
  putMasterV5(io, { beatClock: 240 }); // 既定値とは異なる beat_clock
  ioPutAsciiString(io, "num UNIT");
  ioPutInt32LE(io, 4);
  ioPutU16LE(io, 4096); // unit 数の上限を超えており FMT_NEW になる
  ioPutU16LE(io, 0);
  ioPutAsciiString(io, "pxtoneND");
  ioPutInt32LE(io, 0);
  io.seek(0, 0);
  expect(s.read(io)).toBe(PxtnErr.FMT_NEW);
  // C++ は失敗時に clear() を通るため、途中まで読んだ master の値も破棄される
  expect(s.master.beatClock).toBe(480);
  expect(s.unitNum).toBe(0);
});

it("treats negative num UNIT as FMT_UNKNOWN like C++ int16", () => {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  putV5ProjectHeader(io);
  putMasterV5(io);
  ioPutAsciiString(io, "num UNIT");
  ioPutInt32LE(io, 4);
  ioPutU16LE(io, 0xffff); // int16 で -1 になる
  ioPutU16LE(io, 0);
  ioPutAsciiString(io, "pxtoneND");
  ioPutInt32LE(io, 0);
  io.seek(0, 0);
  // C++ は int16_t num < 0 を FMT_UNKNOWN とする (u16 の 65535 は FMT_NEW ではない)
  expect(s.read(io)).toBe(PxtnErr.FMT_UNKNOWN);
});

it("rejects unknown tags while pre-counting events", () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  putV5ProjectHeader(io);
  putMasterV5(io);
  ioPutAsciiString(io, "ZZZZZZZZ"); // 未知のタグ
  ioPutInt32LE(io, 0);
  io.seek(0, 0);
  // C++ の _pre_count_event は未知タグで fatal を返す
  expect(s.read(io)).toBe(PxtnErr.FATAL);
});

it("tune write/read keeps same event data", () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  s.evels.allocate(4096);
  s.evels.recordAddI(0, 0, EventKind.ON, 480);
  s.evels.recordAddI(0, 0, EventKind.KEY, EVENTDEFAULT_KEY);
  const io = new MemoryIo();
  expect(s.write(io, true, 0)).toBe(PxtnErr.OK);

  const s2 = new Service();
  expect(s2.init()).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);
  expect(s2.evels.count).toBe(2);
});

