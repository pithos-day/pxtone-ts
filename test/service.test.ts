import { it, expect } from "vitest";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { Woice, WoiceType, VoiceType, PTV_DATAFLAG_WAVE, PTV_DATAFLAG_ENVELOPE } from "../src/woice.js";
import { EventKind, EVENTDEFAULT_BASICKEY, EVENTDEFAULT_KEY } from "../src/event.js";

function makePtvWoice(): Woice {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.basicKey = EVENTDEFAULT_BASICKEY;
  vc.volume = 34;
  vc.pan = 64;
  vc.tuning = 1.0;
  vc.type = VoiceType.Coodinate;
  vc.dataFlags = PTV_DATAFLAG_WAVE | PTV_DATAFLAG_ENVELOPE;
  vc.wave = {
    num: 5,
    reso: 64,
    points: [
      { x: 0, y: 0 },
      { x: 29, y: 0 },
      { x: 30, y: 64 },
      { x: 59, y: 64 },
      { x: 60, y: 0 },
    ],
  };
  vc.envelope = {
    fps: 60,
    headNum: 1,
    bodyNum: 0,
    tailNum: 1,
    points: [
      { x: 0, y: 64 },
      { x: 1000, y: 0 },
    ],
  };
  return w;
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
  writeAscii(io, "PTCOLLAGE-071119");
  ioPutU16(io, 0);
  ioPutU16(io, 0);
  writeAscii(io, "MasterV5");
  ioPutI32(io, 15);
  ioPutU16(io, 480); // beat_clock
  ioPutU8(io, 4); // beat_num
  ioPutF32(io, 120.0); // beat_tempo
  ioPutI32(io, 0); // clock_repeat
  ioPutI32(io, 0); // clock_last
  writeAscii(io, "antiOPER");
  ioPutI32(io, 0);
  writeAscii(io, "pxtoneND");
  ioPutI32(io, 0);
  io.seek(0, 0);
  expect(s.read(io)).toBe(PxtnErr.ANTI_OPERATION);
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

function writeAscii(io: MemoryIo, s: string): void {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  io.write(b, 1, b.length);
}

function ioPutU16(io: MemoryIo, v: number): void {
  io.write(new Uint8Array([v & 0xff, (v >> 8) & 0xff]), 1, 2);
}

function ioPutI32(io: MemoryIo, v: number): void {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  io.write(b, 1, 4);
}

function ioPutF32(io: MemoryIo, v: number): void {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  io.write(b, 1, 4);
}

function ioPutU8(io: MemoryIo, v: number): void {
  io.write(new Uint8Array([v]), 1, 1);
}
