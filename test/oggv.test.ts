import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { Woice, WoiceType, VoiceType, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { defaultOggvDecoder, convertOggvToPcm } from "../src/oggv.js";

const here = dirname(fileURLToPath(import.meta.url));
const toneOgg = new Uint8Array(readFileSync(join(here, "fixtures", "test-tone.ogg")));

// OGGV ボイスを 1 つ持つ ptcop を構築 (デコード前の生 ogg として保存)
function buildOggvPtcop(): Uint8Array {
  const s = new Service();
  expect(s.initCollage(4096)).toBe(PxtnErr.OK);
  s.master.setBeatClock(480);

  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.type = VoiceType.OggVorbis;
  vc.basicKey = 0x4500;
  vc.voiceFlags = PTV_VOICEFLAG_WAVELOOP;
  vc.tuning = 1.0;
  vc.oggv = { ch: 2, sps: 44100, smpNum: 44100, data: toneOgg };
  const ioW = new MemoryIo();
  expect(w.ioMateOggvW(ioW)).toBe(true);
  ioW.seek(0, 0);
  expect(s.woiceRead(0, ioW, WoiceType.OGGV)).toBe(PxtnErr.OK);

  s.unitAddNew();
  s.unitGet(0)!.setNameBuf("oggv-unit");
  s.evels.recordAddI(0, 0, 1, 480); // ON (1 拍)
  s.evels.recordAddI(0, 0, 2, 0x6000); // KEY

  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);
  io.seek(0, 0);
  const bytes = ioGetAll(io);
  return bytes;
}

function ioGetAll(io: MemoryIo): Uint8Array {
  io.seek(0, 0);
  const b = new Uint8Array(io.size);
  io.read(b, 1, io.size);
  return b;
}

it("ioMateOggvW/R round trips", () => {
  const w = new Woice();
  const io = new MemoryIo();
  // まず W で書ける woice を構築
  const w2 = new Woice();
  w2.voiceAllocate(1);
  const vc = w2.getVoice(0)!;
  vc.type = VoiceType.OggVorbis;
  vc.basicKey = 0x4500;
  vc.voiceFlags = PTV_VOICEFLAG_WAVELOOP;
  vc.tuning = 1.0;
  vc.oggv = { ch: 2, sps: 44100, smpNum: 44100, data: toneOgg };
  expect(w2.ioMateOggvW(io)).toBe(true);

  io.seek(0, 0);
  expect(w.ioMateOggvR(io)).toBe(PxtnErr.OK);
  expect(w.type).toBe(WoiceType.OGGV);
  expect(w.isOggvDecoded()).toBe(false);
  const vc2 = w.getVoice(0)!;
  expect(vc2.type).toBe(VoiceType.OggVorbis);
  expect(vc2.basicKey).toBe(0x4500);
  expect(vc2.oggv).not.toBeNull();
  expect(vc2.oggv!.data).toEqual(toneOgg);
  expect(vc2.oggv!.ch).toBe(2);
  expect(vc2.oggv!.sps).toBe(44100);
});

it("decodeOggv converts ogg to PCM", async () => {
  const w = new Woice();
  const io = new MemoryIo();
  const src = new Woice();
  src.voiceAllocate(1);
  const vc = src.getVoice(0)!;
  vc.type = VoiceType.OggVorbis;
  vc.oggv = { ch: 2, sps: 44100, smpNum: 44100, data: toneOgg };
  expect(src.ioMateOggvW(io)).toBe(true);
  io.seek(0, 0);
  expect(w.ioMateOggvR(io)).toBe(PxtnErr.OK);

  expect(await w.decodeOggv(defaultOggvDecoder)).toBe(PxtnErr.OK);
  expect(w.isOggvDecoded()).toBe(true);
  const vc2 = w.getVoice(0)!;
  expect(vc2.pcm.ch).toBe(2);
  expect(vc2.pcm.sps).toBe(44100);
  expect(vc2.pcm.smpBody).toBeGreaterThan(40000); // ~1 秒
  // 非ゼロのサンプルが含まれる (正弦波)
  let nonzero = 0;
  const dv = new DataView(vc2.pcm.pBuf!.buffer, vc2.pcm.pBuf!.byteOffset);
  for (let i = 0; i < vc2.pcm.smpBody; i++) {
    if (dv.getInt16(i * 4, true) !== 0) nonzero++;
  }
  expect(nonzero).toBeGreaterThan(100);
});

it("quantizes decoded samples like libvorbisfile ov_read", async () => {
  // C++ は float 乗算 *32768.f → 最近接丸め (タイは偶数) → [-32768, 32767] クランプ
  const source = new Float32Array([
    0.75, -1.0, 1.0, 0.5, -0.5, 0.0001,
    1.5 / 32768, 2.5 / 32768, -1.5 / 32768,
  ]);
  const decoder = {
    decode: async () => ({ ch: 1, sps: 44100, samples: [source] }),
  };
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.type = VoiceType.OggVorbis;
  vc.oggv = { ch: 1, sps: 44100, smpNum: source.length, data: new Uint8Array([0]) };
  expect(await w.decodeOggv(decoder)).toBe(PxtnErr.OK);
  const dv = new DataView(vc.pcm.pBuf!.buffer, vc.pcm.pBuf!.byteOffset);
  const expected = [24576, -32768, 32767, 16384, -16384, 3, 2, 2, -2];
  for (let i = 0; i < expected.length; i++) {
    expect(dv.getInt16(i * 2, true), `i=${i}`).toBe(expected[i]);
  }
});

it("convertOggvToPcm produces a playable PCM-based ptcop", async () => {
  const bytes = buildOggvPtcop();
  const converted = await convertOggvToPcm(bytes);
  expect(converted).not.toBeNull();

  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo(converted!);
  expect(s.read(io)).toBe(PxtnErr.OK);
  expect(s.woiceNum).toBe(1);
  expect(s.woiceGet(0)!.type).toBe(WoiceType.PCM); // OGGV → PCM 化されている
  expect(s.tonesReady()).toBe(PxtnErr.OK);

  s.setDestinationQuality(2, 44100);
  expect(s.mooPreparation(null)).toBe(true);
  const out = new Int16Array(44100 * 2);
  expect(s.Moo(out, 44100)).toBe(true);
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    if (a > max) max = a;
  }
  expect(max).toBeGreaterThan(100);
});

it("convertOggvToPcm passes through files without OGGV", async () => {
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  s.evels.recordAddI(0, 0, 1, 480);
  const io = new MemoryIo();
  expect(s.write(io, false, 0)).toBe(PxtnErr.OK);
  const bytes = ioGetAll(io);
  const result = await convertOggvToPcm(bytes);
  expect(result).not.toBeNull();
  expect(result).toEqual(bytes);
});

it("convertOggvToPcm writes the given exeVer to the header", async () => {
  const bytes = buildOggvPtcop();
  const converted = await convertOggvToPcm(bytes, 0x9456);
  expect(converted).not.toBeNull();
  // ヘッダ: 16 バイトのバージョンコード直後に U16LE で exeVer
  const dv = new DataView(converted!.buffer, converted!.byteOffset, converted!.byteLength);
  expect(dv.getUint16(16, true)).toBe(0x9456);
});

it("convertOggvToPcm defaults exeVer to 0 (backward compatible)", async () => {
  const bytes = buildOggvPtcop();
  const converted = await convertOggvToPcm(bytes);
  expect(converted).not.toBeNull();
  const dv = new DataView(converted!.buffer, converted!.byteOffset, converted!.byteLength);
  expect(dv.getUint16(16, true)).toBe(0);
});

it("reads and plays the real Funeral_March.ptcop (OGGV)", async () => {
  const bytes = new Uint8Array(readFileSync(join(here, "fixtures", "Funeral_March.ptcop")));
  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo(bytes);
  expect(s.read(io)).toBe(PxtnErr.OK);
  expect(s.woiceNum).toBe(1);
  expect(s.woiceGet(0)!.type).toBe(WoiceType.OGGV);
  expect(s.evels.count).toBe(6989);

  expect(await s.decodeOggvAll(defaultOggvDecoder)).toBe(PxtnErr.OK);
  expect(s.woiceGet(0)!.isOggvDecoded()).toBe(true);
  expect(s.tonesReady()).toBe(PxtnErr.OK);

  s.setDestinationQuality(2, 44100);
  expect(s.mooPreparation(null)).toBe(true);
  const out = new Int16Array(44100 * 2);
  expect(s.Moo(out, 44100)).toBe(true);
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]!);
    if (a > max) max = a;
  }
  expect(max).toBeGreaterThan(100);
});

it("converts Funeral_March.ptcop to PCM and renders identically", async () => {
  const bytes = new Uint8Array(readFileSync(join(here, "fixtures", "Funeral_March.ptcop")));
  const converted = await convertOggvToPcm(bytes);
  expect(converted).not.toBeNull();

  const s = new Service();
  expect(s.init()).toBe(PxtnErr.OK);
  const io = new MemoryIo(converted!);
  expect(s.read(io)).toBe(PxtnErr.OK);
  expect(s.woiceGet(0)!.type).toBe(WoiceType.PCM);
  expect(s.tonesReady()).toBe(PxtnErr.OK);
  s.setDestinationQuality(2, 44100);
  expect(
    s.mooPreparation({ startPosMeas: 0, startPosSample: 0, startPosFloat: 0, measEnd: 0, measRepeat: 0, fadeinSec: 0, flags: 0, masterVolume: 1.0 }),
  ).toBe(true);

  // 変換前後の出力が一致する
  const s2 = new Service();
  expect(s2.init()).toBe(PxtnErr.OK);
  const io2 = new MemoryIo(bytes);
  expect(s2.read(io2)).toBe(PxtnErr.OK);
  expect(await s2.decodeOggvAll(defaultOggvDecoder)).toBe(PxtnErr.OK);
  expect(s2.tonesReady()).toBe(PxtnErr.OK);
  s2.setDestinationQuality(2, 44100);
  expect(
    s2.mooPreparation({ startPosMeas: 0, startPosSample: 0, startPosFloat: 0, measEnd: 0, measRepeat: 0, fadeinSec: 0, flags: 0, masterVolume: 1.0 }),
  ).toBe(true);

  const total = s.mooGetSamplingEnd();
  expect(s2.mooGetSamplingEnd()).toBe(total);
  const a = new Int16Array(Math.min(total, 44100) * 2);
  const b = new Int16Array(Math.min(total, 44100) * 2);
  expect(s.Moo(a, Math.min(total, 44100))).toBe(true);
  expect(s2.Moo(b, Math.min(total, 44100))).toBe(true);
  for (let i = 0; i < a.length; i++) {
    expect(a[i]).toBe(b[i]);
  }
});
