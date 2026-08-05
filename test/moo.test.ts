import { it, expect } from "vitest";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { Woice, VoiceType, PTV_DATAFLAG_WAVE, PTV_DATAFLAG_ENVELOPE, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { EventKind } from "../src/event.js";
import { pxtnServiceMooCalcSampleNum } from "../src/service.js";

function makePtvWoice(): Woice {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.basicKey = 0x4500;
  vc.volume = 128;
  vc.pan = 64;
  vc.tuning = 1.0;
  vc.type = VoiceType.Coodinate;
  vc.dataFlags = PTV_DATAFLAG_WAVE | PTV_DATAFLAG_ENVELOPE;
  vc.voiceFlags = PTV_VOICEFLAG_WAVELOOP;
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

function buildService(beatClock: number): Service {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  s.master.setBeatClock(beatClock);
  const ioW = new MemoryIo();
  makePtvWoice().ptvWrite(ioW);
  ioW.seek(0, 0);
  expect(s.woiceRead(0, ioW, 2)).toBe(PxtnErr.OK);
  s.unitAddNew();
  s.unitGet(0)!.setNameBuf("unit0");
  s.unitSetOperatedAll(true);
  s.tonesReady();
  return s;
}

it("mooGetTotalSample matches C++ formula", () => {
  expect(pxtnServiceMooCalcSampleNum(1, 4, 44100, 120)).toBe(88200);
  expect(pxtnServiceMooCalcSampleNum(2, 4, 44100, 120)).toBe(176400);
  expect(pxtnServiceMooCalcSampleNum(4, 4, 44100, 120)).toBe(352800);
  expect(pxtnServiceMooCalcSampleNum(1, 4, 44100, 0)).toBe(0);
});

it("renders audible samples from an ON event", () => {
  const s = buildService(480);
  expect(s.evels.recordAddI(0, 0, EventKind.ON, 480)).toBe(true); // 1 beat
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, 0x6000)).toBe(true);
  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK); // project: rough=1, beatClock preserved
  const s2 = new Service();
  expect(s2.initCollage(4096)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);
  expect(s2.mooIsValidData()).toBe(true);
  expect(s2.tonesReady()).toBe(PxtnErr.OK);
  s2.setDestinationQuality(2, 44100);
  expect(s2.mooPreparation(null)).toBe(true);

  const buf = new Int16Array(4096 * 2);
  expect(s2.Moo(buf, 4096)).toBe(true);
  expect(s2.mooIsEndVomit()).toBe(false);

  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > max) max = a;
  }
  expect(max).toBeGreaterThan(0);
});

it("stops rendering at song end without loop", () => {
  const s = buildService(480);
  expect(s.evels.recordAddI(0, 0, EventKind.ON, 4800)).toBe(true);
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, 0x6000)).toBe(true);
  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);
  const s2 = new Service();
  expect(s2.initCollage(4096)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);
  expect(s2.tonesReady()).toBe(PxtnErr.OK);
  s2.setDestinationQuality(2, 44100);
  s2.mooSetLoop(false);
  expect(s2.mooPreparation(null)).toBe(true);

  // ON=4800 clock = 10 beats = 3 measures (切り上げ) → smp_end = 3*88200 = 264600
  expect(s2.mooGetSamplingEnd()).toBe(264600);

  // render in chunks until end
  let done = false;
  let rendered = 0;
  while (!done && rendered < 1000000) {
    const buf = new Int16Array(44100 * 2); // 1 sec
    if (!s2.Moo(buf, 44100)) done = true;
    rendered += 44100;
  }
  expect(rendered).toBeGreaterThanOrEqual(264600);
  expect(s2.mooGetNowClock()).toBe(5760); // end clock = 264600/45.9375
});

it("loops back to repeat point", () => {
  const s = buildService(480);
  expect(s.evels.recordAddI(0, 0, EventKind.ON, 4800)).toBe(true);
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, 0x6000)).toBe(true);
  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);
  const s2 = new Service();
  expect(s2.initCollage(4096)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  expect(s2.read(io)).toBe(PxtnErr.OK);
  expect(s2.tonesReady()).toBe(PxtnErr.OK);
  s2.setDestinationQuality(2, 44100);
  s2.mooSetLoop(true);
  expect(s2.mooPreparation(null)).toBe(true);

  // render more than one loop length; should not end
  const buf = new Int16Array(88200 * 2 + 1000 * 2);
  expect(s2.Moo(buf, 88200 + 1000)).toBe(true);
  expect(s2.mooIsEndVomit()).toBe(false);
});
