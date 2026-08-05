import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";

const SAMPLE_PATH = "/home/admin/Documents/References/Pxtone/pxtone-source-code 220910a/sample data/sample.ptcop";

it("reads the real sample.ptcop", () => {
  const buf = readFileSync(SAMPLE_PATH);
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo(new Uint8Array(buf));
  expect(s.read(io)).toBe(PxtnErr.OK);
  expect(s.text.getNameString()).toBe("Hard Cording");
  expect(s.woiceNum).toBe(8);
  expect(s.unitNum).toBe(7);
  expect(s.evels.count).toBe(6682);
  expect(s.master.beatTempo).toBe(150);
  expect(s.master.beatClock).toBe(480);
});

it("renders audible samples from the real sample.ptcop", () => {
  const buf = readFileSync(SAMPLE_PATH);
  const s = new Service();
  s.init();
  const io = new MemoryIo(new Uint8Array(buf));
  expect(s.read(io)).toBe(PxtnErr.OK);
  expect(s.tonesReady()).toBe(PxtnErr.OK);
  s.setDestinationQuality(2, 44100);
  expect(s.mooPreparation(null)).toBe(true);
  expect(s.mooGetTotalSample()).toBe(2892960);

  const out = new Int16Array(44100 * 2);
  expect(s.Moo(out, 44100)).toBe(true);
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    if (a > max) max = a;
  }
  expect(max).toBeGreaterThan(1000);
});
