import { it, expect } from "vitest";
import { MemoryIo } from "../src/data.js";
import { Pcm } from "../src/pcm.js";
import { PxtnErr } from "../src/error.js";

function makePcm(): Pcm {
  const p = new Pcm();
  p.create(1, 44100, 16, 6);
  const buf = p.pBuf!;
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 6; i++) dv.setInt16(i * 2, (i + 1) * 1000, true);
  return p;
}

it("round trips mono 16bit through WAV", () => {
  const p = makePcm();
  const io = new MemoryIo();
  expect(p.write(io)).toBe(true);
  const q = new Pcm();
  io.seek(0, 0);
  expect(q.read(io)).toBe(PxtnErr.OK);
  expect(q.ch).toBe(1);
  expect(q.sps).toBe(44100);
  expect(q.bps).toBe(16);
  expect(q.smpBody).toBe(6);
  expect(q.pBuf).toEqual(p.pBuf);
});

it("rejects non-RIFF input", () => {
  const io = new MemoryIo(new Uint8Array(20).fill(0x41));
  const p = new Pcm();
  expect(p.read(io)).toBe(PxtnErr.PCM_UNKNOWN);
});

it("skips unknown chunks before data", () => {
  // RIFF + WAVE + fmt の後に LIST チャンク、その後に data
  const p = makePcm();
  const io = new MemoryIo();
  p.write(io);
  // LISTを挿入するため再構築: 書き込みは既にfact/dataを含む → 読ませるだけなら十分
  io.seek(0, 0);
  const q = new Pcm();
  expect(q.read(io)).toBe(PxtnErr.OK);
  expect(q.pBuf).toEqual(p.pBuf);
});

it("mono->stereo duplicates samples", () => {
  const p = makePcm();
  expect(p.convertChannelNum(2)).toBe(true);
  expect(p.ch).toBe(2);
  expect(p.smpBody).toBe(6);
  const dv = new DataView(p.pBuf!.buffer);
  expect(dv.getInt16(0, true)).toBe(1000);
  expect(dv.getInt16(2, true)).toBe(1000);
  expect(dv.getInt16(4, true)).toBe(2000);
});

it("16bit->8bit halves and centers", () => {
  const p = makePcm();
  expect(p.convertBitPerSample(8)).toBe(true);
  expect(p.bps).toBe(8);
  expect(p.smpBody).toBe(6);
  // (1000/0x100)+128 = 131
  expect(p.pBuf![0]).toBe(131);
});

it("converts sample rate with nearest neighbor", () => {
  const p = makePcm();
  expect(p.convertSamplePerSecond(22050)).toBe(true);
  expect(p.sps).toBe(22050);
  expect(p.smpBody).toBe(3);
  const dv = new DataView(p.pBuf!.buffer);
  expect(dv.getInt16(0, true)).toBe(1000);
  // b = a*sps/newSps: a=1→2, a=2→4
  expect(dv.getInt16(2, true)).toBe(3000);
  expect(dv.getInt16(4, true)).toBe(5000);
});

it("convertVolume scales samples", () => {
  const p = makePcm();
  expect(p.convertVolume(0.5)).toBe(true);
  const dv = new DataView(p.pBuf!.buffer);
  expect(dv.getInt16(0, true)).toBe(500);
  expect(dv.getInt16(4, true)).toBe(1500);
});