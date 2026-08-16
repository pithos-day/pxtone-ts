// OGG Vorbis デコード。@wasm-audio-decoders/ogg-vorbis をラップする。
// WASM は JS に base64 埋め込みされており、外部フェッチ不要で
// ブラウザ / Node / Web Worker のどこでも import だけで動作する。

import { OggVorbisDecoder } from "@wasm-audio-decoders/ogg-vorbis";
import { Service } from "./service.js";
import { MemoryIo, ioGetBytes } from "./data.js";
import { PxtnErr } from "./error.js";
import { WoiceType } from "./woice.js";

export interface OggvDecoded {
  ch: number;
  sps: number;
  samples: Float32Array[];
}

export interface OggvDecoder {
  decode(bytes: Uint8Array): Promise<OggvDecoded>;
}

export class WasmOggvDecoder implements OggvDecoder {
  private decoder: OggVorbisDecoder | null = null;

  async decode(bytes: Uint8Array): Promise<OggvDecoded> {
    if (!this.decoder) this.decoder = new OggVorbisDecoder();
    await this.decoder.ready;
    const r = await this.decoder.decodeFile(bytes);
    return { ch: r.channelData.length, sps: r.sampleRate, samples: r.channelData };
  }
}

export const defaultOggvDecoder: OggvDecoder = new WasmOggvDecoder();

// OGGV ボイスを含む ptcop を「デコード済み PCM 化した ptcop」に変換する。
// OGGV が含まれない場合は入力をそのまま返す。
// AudioWorklet (fetch 不可) に渡す前に、メインスレッドで実行することを想定。
// exeVer: 再シリアライズ時にヘッダへ書き込むエディタバージョン (未指定なら 0)
export async function convertOggvToPcm(
  bytes: Uint8Array,
  exeVer?: number,
): Promise<Uint8Array | null> {
  const s = new Service();
  if (s.init() !== PxtnErr.OK) return null;
  const io = new MemoryIo(bytes);
  if (s.read(io) !== PxtnErr.OK) return null;

  let hasOggv = false;
  for (let i = 0; i < s.woiceNum; i++) {
    if (s.woiceGet(i)?.type === WoiceType.OGGV) {
      hasOggv = true;
      break;
    }
  }
  if (!hasOggv) return bytes;

  if ((await s.decodeOggvAll(defaultOggvDecoder)) !== PxtnErr.OK) return null;

  // デコード済み OGGV は write 時に matePCM として再シリアライズされる
  const out = new MemoryIo();
  if (s.write(out, false, exeVer ?? 0) !== PxtnErr.OK) return null;
  out.seek(0, 0);
  return ioGetBytes(out, out.size);
}
