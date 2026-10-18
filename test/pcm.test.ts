import { it, expect } from "vitest";
import { MemoryIo, ioPutAsciiString, ioPutU16LE, ioPutUint32LE } from "../src/data.js";
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
  // fmt の後に未知チャンク (LIST + INFO/ISFT) を挟み、その後に data を置く
  const p = makePcm();
  const samples = p.pBuf!;
  const sampleSize = samples.length;
  const text = "test!";
  const isftSize = text.length;
  const listSize = 4 + 4 + 4 + isftSize;
  const riffSize = sampleSize + 4 + 26 + 12 + 8 + 8 + listSize;

  const io = new MemoryIo();
  ioPutAsciiString(io, "RIFF");
  ioPutUint32LE(io, riffSize);
  ioPutAsciiString(io, "WAVE");
  ioPutAsciiString(io, "fmt ");
  ioPutUint32LE(io, 0x12);
  ioPutU16LE(io, 0x0001);
  ioPutU16LE(io, p.ch);
  ioPutUint32LE(io, p.sps);
  ioPutUint32LE(io, (p.sps * p.bps * p.ch) / 8);
  ioPutU16LE(io, (p.bps * p.ch) / 8);
  ioPutU16LE(io, p.bps);
  ioPutU16LE(io, 0);
  ioPutAsciiString(io, "LIST");
  ioPutUint32LE(io, listSize);
  ioPutAsciiString(io, "INFO");
  ioPutAsciiString(io, "ISFT");
  ioPutUint32LE(io, isftSize);
  ioPutAsciiString(io, text);
  ioPutAsciiString(io, "data");
  ioPutUint32LE(io, sampleSize);
  io.write(samples, 1, sampleSize);

  io.seek(0, 0);
  const q = new Pcm();
  expect(q.read(io)).toBe(PxtnErr.OK);
  expect(q.ch).toBe(1);
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

it("16bit->8bit truncates negative samples toward zero", () => {
  const p = new Pcm();
  p.create(1, 44100, 16, 3);
  const dv = new DataView(p.pBuf!.buffer);
  dv.setInt16(0, -32767, true); // -32767/0x100 = -127.99.. → -127 → +128 = 1
  dv.setInt16(2, -128, true); // -128/0x100 = -0.5 → 0 → +128 = 128
  dv.setInt16(4, -32768, true); // -128 → +128 = 0
  expect(p.convertBitPerSample(8)).toBe(true);
  expect(Array.from(p.pBuf!)).toEqual([1, 128, 0]);
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

it("truncates head/body/tail with C++ int division on sps conversion", () => {
  // 44100 -> 22051 では再スケール後の body バイト数が 4 や 2 で割り切れない。
  // C++ は _smp_head/body/tail = byte / 4 (または / 2) の int 除算のため小数部が落ちる
  const st16 = new Pcm();
  st16.create(2, 44100, 16, 6); // 24 bytes -> 13 -> 13/4 = 3
  expect(st16.convertSamplePerSecond(22051)).toBe(true);
  expect(st16.sps).toBe(22051);
  expect(st16.smpBody).toBe(3); // 旧実装は 3.25
  expect(st16.totalSampleNum).toBe(6);
  expect(st16.bufSize).toBe(12);

  const mono16 = new Pcm();
  mono16.create(1, 44100, 16, 6); // 12 bytes -> 7 -> 7/2 = 3
  expect(mono16.convertSamplePerSecond(22051)).toBe(true);
  expect(mono16.smpBody).toBe(3); // 旧実装は 3.5
  expect(mono16.totalSampleNum).toBe(3);
  expect(mono16.bufSize).toBe(6);

  const st8 = new Pcm();
  st8.create(2, 44100, 8, 6); // 12 bytes -> 7 -> 7/2 = 3
  expect(st8.convertSamplePerSecond(22051)).toBe(true);
  expect(st8.smpBody).toBe(3); // 旧実装は 3.5
  expect(st8.totalSampleNum).toBe(6);
  expect(st8.bufSize).toBe(6);

  // mono8 は /1 のため元から整数 (回帰確認)
  const mono8 = new Pcm();
  mono8.create(1, 44100, 8, 6); // 6 bytes -> 4 -> 4/1 = 4
  expect(mono8.convertSamplePerSecond(22051)).toBe(true);
  expect(mono8.smpBody).toBe(4);
  expect(mono8.bufSize).toBe(4);
});
