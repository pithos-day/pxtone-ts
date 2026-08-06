import { it, expect } from "vitest";
import { Service, pxtnServiceMooCalcSampleNum } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { EventKind, EVENTDEFAULT_KEY } from "../src/event.js";
import { makePtvWoice } from "./helpers.js";

function buildService(beatClock: number): Service {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  s.master.setBeatClock(beatClock);
  const ioW = new MemoryIo();
  makePtvWoice({ volume: 128, loop: true }).ptvWrite(ioW);
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
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, EVENTDEFAULT_KEY)).toBe(true);
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
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, EVENTDEFAULT_KEY)).toBe(true);
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
  // end clock = サンプル数 ÷ クロックレート (44100 ÷ (60*120/480) = 45.9375)
  expect(s2.mooGetNowClock()).toBe(5760);
});

it("loops back to repeat point", () => {
  const s = buildService(480);
  expect(s.evels.recordAddI(0, 0, EventKind.ON, 4800)).toBe(true);
  expect(s.evels.recordAddI(0, 0, EventKind.KEY, EVENTDEFAULT_KEY)).toBe(true);
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
