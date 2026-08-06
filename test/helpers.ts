// テスト共通フィクスチャ

import { Woice, WoiceType, VoiceType, PTV_DATAFLAG_WAVE, PTV_DATAFLAG_ENVELOPE, PTV_VOICEFLAG_WAVELOOP } from "../src/woice.js";
import { Pcm } from "../src/pcm.js";
import { EVENTDEFAULT_BASICKEY } from "../src/event.js";

// 固定の PTV 音色 (座標波形 + エンベロープ)。
// volume と loop (WAVELOOP) のみ呼び出し側で変更できる。
export function makePtvWoice(options: { volume?: number; loop?: boolean } = {}): Woice {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.basicKey = EVENTDEFAULT_BASICKEY;
  vc.volume = options.volume ?? 34;
  vc.pan = 64;
  vc.tuning = 1.0;
  vc.type = VoiceType.Coodinate;
  vc.dataFlags = PTV_DATAFLAG_WAVE | PTV_DATAFLAG_ENVELOPE;
  if (options.loop) vc.voiceFlags = PTV_VOICEFLAG_WAVELOOP;
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

// 固定の PCM 音色: 8 サンプル (1000, 2000, ..., 8000) のモノラル 16bit。
// loop 指定時は WAVELOOP フラグを立てる。
export function makePcmWoice(loop: boolean): Woice {
  const w = new Woice();
  w.voiceAllocate(1);
  const vc = w.getVoice(0)!;
  vc.type = VoiceType.Sampling;
  vc.basicKey = EVENTDEFAULT_BASICKEY;
  vc.volume = 128;
  vc.pan = 64;
  vc.tuning = 1.0;
  vc.voiceFlags = loop ? PTV_VOICEFLAG_WAVELOOP : 0;
  const p = new Pcm();
  p.create(1, 44100, 16, 8);
  const dv = new DataView(p.pBuf!.buffer);
  for (let i = 0; i < 8; i++) dv.setInt16(i * 2, (i + 1) * 500, true);
  vc.pcm = p;
  return w;
}
