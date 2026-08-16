// オフライン全曲レンダリング (1 周分・ループなし・音量 1.0)
// AudioWorklet リアルタイム再生との整合性検証リファレンス
//
// 注: bytes は呼び出し側で convertOggvToPcm() 済みの ptcop を渡すこと
// (変換の実行はここでは行わない。呼び出し側で 1 回だけ行う)

import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";

export interface OfflineRenderResult {
  data: Int16Array;
  totalSample: number;
}

export async function renderOffline(bytes: Uint8Array, sps = 44100, chunk = 44100): Promise<OfflineRenderResult | null> {
  const s = new Service();
  if (s.init() !== PxtnErr.OK) return null;
  const io = new MemoryIo(bytes);
  if (s.read(io) !== PxtnErr.OK) return null;
  if (s.tonesReady() !== PxtnErr.OK) return null;
  s.setDestinationQuality(2, sps);
  if (
    !s.mooPreparation({
      startPosMeas: 0,
      startPosSample: 0,
      startPosFloat: 0,
      measEnd: 0,
      measRepeat: 0,
      fadeinSec: 0,
      flags: 0,
      masterVolume: 1.0,
    })
  ) {
    return null;
  }
  const total = s.mooGetSamplingEnd();
  const out = new Int16Array(total * 2);
  for (let pos = 0; pos < total; pos += chunk) {
    const n = Math.min(chunk, total - pos);
    s.Moo(out.subarray(pos * 2), n);
  }
  return { data: out, totalSample: total };
}
