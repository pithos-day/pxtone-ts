import { it, expect } from "vitest";
import { Service } from "../src/service.js";
import { MemoryIo, ioPutAsciiString, ioPutFloatLE, ioPutInt32LE, ioPutU16LE, ioPutU8 } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { WoiceType } from "../src/woice.js";
import { EventKind, EVENTDEFAULT_KEY } from "../src/event.js";
import { makePtvWoice } from "./helpers.js";

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
  ioPutAsciiString(io, "PTCOLLAGE-071119");
  ioPutU16LE(io, 0);
  ioPutU16LE(io, 0);
  ioPutAsciiString(io, "MasterV5");
  ioPutInt32LE(io, 15);
  ioPutU16LE(io, 480); // beat_clock
  ioPutU8(io, 4); // beat_num
  ioPutFloatLE(io, 120.0); // beat_tempo
  ioPutInt32LE(io, 0); // clock_repeat
  ioPutInt32LE(io, 0); // clock_last
  ioPutAsciiString(io, "antiOPER");
  ioPutInt32LE(io, 0);
  ioPutAsciiString(io, "pxtoneND");
  ioPutInt32LE(io, 0);
  io.seek(0, 0);
  expect(s.read(io)).toBe(PxtnErr.ANTI_OPERATION);
});

it("rejects unknown tags while pre-counting events", () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo();
  ioPutAsciiString(io, "PTCOLLAGE-071119");
  ioPutU16LE(io, 0);
  ioPutU16LE(io, 0);
  ioPutAsciiString(io, "MasterV5");
  ioPutInt32LE(io, 15);
  ioPutU16LE(io, 480); // beat_clock
  ioPutU8(io, 4); // beat_num
  ioPutFloatLE(io, 120.0); // beat_tempo
  ioPutInt32LE(io, 0); // clock_repeat
  ioPutInt32LE(io, 0); // clock_last
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

