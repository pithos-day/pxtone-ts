import { it, expect } from "vitest";
import { MemoryIo } from "../src/data.js";
import { Woice, WoiceType, VoiceType, PTV_DATAFLAG_WAVE, PTV_DATAFLAG_ENVELOPE, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { Pcm } from "../src/pcm.js";
import { PxtnErr } from "../src/error.js";
import { EVENTDEFAULT_BASICKEY } from "../src/event.js";

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

it("matePTV round trips", () => {
  const w = makePtvWoice();
  const io = new MemoryIo();
  expect(w.ioMatePtvW(io)).toBe(true);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.ioMatePtvR(io)).toBe(PxtnErr.OK);
  expect(w2.type).toBe(WoiceType.PTV);
  const vc = w2.getVoice(0)!;
  expect(vc.type).toBe(VoiceType.Coodinate);
  expect(vc.volume).toBe(34);
  expect(vc.pan).toBe(64);
  expect(vc.wave.num).toBe(5);
  expect(vc.wave.reso).toBe(64);
  expect(vc.wave.points).toEqual(w.getVoice(0)!.wave.points);
  expect(vc.envelope.fps).toBe(60);
  expect(vc.envelope.points).toEqual(w.getVoice(0)!.envelope.points);
});

it("PTV read() parses a raw PTVOICE- blob", () => {
  const w = makePtvWoice();
  const io = new MemoryIo();
  expect(w.ptvWrite(io)).toBeGreaterThan(0);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.read(io, WoiceType.PTV)).toBe(PxtnErr.OK);
  expect(w2.voiceNum).toBe(1);
  expect(w2.getVoice(0)!.volume).toBe(34);
});

it("matePCM round trips", () => {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.type = VoiceType.Sampling;
  const p = new Pcm();
  p.create(1, 44100, 16, 8);
  const dv = new DataView(p.pBuf!.buffer);
  for (let i = 0; i < 8; i++) dv.setInt16(i * 2, (i + 1) * 500, true);
  vc.pcm = p;
  vc.basicKey = EVENTDEFAULT_BASICKEY;
  vc.voiceFlags = PTV_VOICEFLAG_WAVELOOP;
  const io = new MemoryIo();
  expect(w.ioMatePcmW(io)).toBe(true);
  const w2 = new Woice();
  io.seek(0, 0);
  expect(w2.ioMatePcmR(io)).toBe(PxtnErr.OK);
  expect(w2.type).toBe(WoiceType.PCM);
  const vc2 = w2.getVoice(0)!;
  expect(vc2.type).toBe(VoiceType.Sampling);
  expect(vc2.pcm.sps).toBe(44100);
  expect(vc2.pcm.smpBody).toBe(8);
  expect(vc2.pcm.pBuf).toEqual(p.pBuf);
  expect(vc2.voiceFlags).toBe(PTV_VOICEFLAG_WAVELOOP);
});

it("toneReady renders 400-sample PTV cache", () => {
  const w = makePtvWoice();
  expect(w.toneReady(null, 44100)).toBe(PxtnErr.OK);
  const vi = w.getInstance(0)!;
  expect(vi.smpBodyW).toBe(400);
  expect(vi.pSmpW!.length).toBe(400 * 2 * 2); // ch=2, bps=16
  expect(vi.envRelease).toBe(Math.trunc((1000 * 44100) / 60));
  expect(vi.pEnv!.length).toBeGreaterThan(0);
});