// AudioWorklet 内で動作する pxtone プレイヤー。
// Service (Moo レンダラー) を worklet スレッド内に置き、process() から
// オフラインと同一のコードパス (Service.Moo) を叩く。

import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";
import { PXTN_VOMIT_PREP_FLAG_LOOP, PXTN_VOMIT_PREP_FLAG_UNIT_MUTE } from "../src/constants.js";
import type { VomitPreparation } from "../src/service.js";
import type { MainToWorklet, WorkletToMain } from "../src/worklet/messages.js";

// AudioWorklet グローバルスコープの最小型定義 (lib.dom の環境差異に依存しない)。
// 実行時は AudioWorkletGlobalScope の実グローバルが解決される。
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BLOCK_SIZE = 128;

class PxtoneWorkletProcessor extends AudioWorkletProcessor {
  private service: Service | null = null;
  private scratch: Int16Array = new Int16Array(BLOCK_SIZE * 2);
  private loaded = false;
  private playing = false;
  private sps = 44100;
  private loop = false;
  private volume = 1.0; // オフライン (mooPreparation(null)) と同一のデフォルト
  private muteByUnit = false;
  private lastPosNotifySample = -1;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => this.onMessage(e.data);
  }

  private post(msg: WorkletToMain): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: MainToWorklet): void {
    switch (msg.type) {
      case "load":
        this.doLoad(msg.bytes, msg.sps);
        break;
      case "play":
        // 曲末で停止中 (ループなし) なら先頭から再設定
        if (this.service?.mooIsEndVomit()) this.reseek(0);
        this.playing = true;
        this.lastPosNotifySample = -1;
        break;
      case "stop":
        this.playing = false;
        break;
      case "seek":
        this.reseek(msg.sample);
        break;
      case "setLoop":
        this.loop = msg.loop;
        this.service?.mooSetLoop(msg.loop);
        break;
      case "setMasterVolume":
        this.volume = msg.volume;
        this.service?.mooSetMasterVolume(msg.volume);
        break;
      case "setMuteByUnit":
        this.muteByUnit = msg.mute;
        this.service?.mooSetMuteByUnit(msg.mute);
        break;
      case "preview":
        // 単音プレビュー: スキーマ定義のみ (将来実装)
        break;
    }
  }

  private doLoad(bytes: ArrayBuffer, sps: number): void {
    this.sps = sps;
    const svc = new Service();
    let error = "";
    const ok = ((): boolean => {
      if (svc.init() !== PxtnErr.OK) {
        error = "init";
        return false;
      }
      const io = new MemoryIo(new Uint8Array(bytes));
      if (svc.read(io) !== PxtnErr.OK) {
        error = "read";
        return false;
      }
      if (svc.tonesReady() !== PxtnErr.OK) {
        error = "tonesReady";
        return false;
      }
      if (!svc.setDestinationQuality(2, sps)) {
        error = "quality";
        return false;
      }
      svc.mooSetLoop(this.loop);
      svc.mooSetMasterVolume(this.volume);
      svc.mooSetMuteByUnit(this.muteByUnit);
      return true;
    })();

    this.service = ok ? svc : null;
    this.loaded = ok;
    this.playing = false;
    this.lastPosNotifySample = -1;
    if (ok) this.reseek(0);

    this.post({
      type: "loaded",
      ok,
      error,
      totalSample: ok ? svc.mooGetSamplingEnd() : 0,
    });
  }

  // 再生位置を再設定 (シーク / 曲末からの再開)。ループ・ミュート・音量を維持する
  private reseek(sample: number): void {
    if (!this.service) return;
    const svc = this.service;
    const max = svc.mooGetSamplingEnd();
    const s = Math.max(0, Math.min(max, Math.trunc(sample)));
    const prep: VomitPreparation = {
      startPosMeas: 0,
      startPosSample: s,
      startPosFloat: 0,
      measEnd: 0,
      measRepeat: 0,
      fadeinSec: 0,
      flags: (this.loop ? PXTN_VOMIT_PREP_FLAG_LOOP : 0) | (this.muteByUnit ? PXTN_VOMIT_PREP_FLAG_UNIT_MUTE : 0),
      masterVolume: this.volume,
    };
    svc.mooPreparation(prep);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const chNum = out.length;
    const block = out[0]!.length;

    if (!this.service || !this.loaded || !this.playing) {
      for (let ch = 0; ch < chNum; ch++) out[ch]!.fill(0);
      return true;
    }

    const svc = this.service;
    // Moo の戻り値は「バッファ生成できたか」だが、終了判定は mooIsEndVomit で行う
    svc.Moo(this.scratch.subarray(0, block * chNum), block);
    for (let i = 0; i < block; i++) {
      for (let ch = 0; ch < chNum; ch++) {
        out[ch]![i] = this.scratch[i * chNum + ch]! / 32768;
      }
    }

    if (svc.mooIsEndVomit()) {
      // 曲末 (ループなし)
      this.playing = false;
      this.post({ type: "ended" });
    } else {
      // 再生位置通知 (約100ms間隔)
      const pos = svc.mooGetSamplingOffset();
      if (pos - this.lastPosNotifySample >= Math.trunc(this.sps / 10)) {
        this.lastPosNotifySample = pos;
        this.post({ type: "position", sample: pos });
      }
    }

    return true;
  }
}

registerProcessor("pxtone-player", PxtoneWorkletProcessor);
