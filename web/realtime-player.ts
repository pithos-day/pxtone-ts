// AudioWorklet プレイヤーのメインスレッド側ラッパー。
// メッセージの送受信とオフライン全曲レンダリング (波形ピーク・WAV書き出し用) をカプセル化する。

import type { MainToWorklet, WorkletToMain } from "../src/worklet/messages.js";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";

const OFFLINE_CHUNK = 44100;

export interface RealtimePlayerOptions {
  onPosition?: (sample: number) => void;
  onEnded?: () => void;
  onLoaded?: (ok: boolean, totalSample: number) => void;
}

export class RealtimePlayer {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private sps = 44100;
  private totalSample = 0;
  private playing = false;
  private lastPosSample = 0;
  private lastPosTime = 0;
  private opts: RealtimePlayerOptions;
  private pendingLoad: { resolve: (ok: boolean) => void } | null = null;

  constructor(opts: RealtimePlayerOptions = {}) {
    this.opts = opts;
  }

  get sampleRate(): number {
    return this.sps;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get durationSec(): number {
    return this.totalSample / this.sps;
  }

  async init(): Promise<void> {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.sps = this.ctx.sampleRate;
    await this.ctx.audioWorklet.addModule(new URL("./player-worklet.js", import.meta.url));
    this.node = new AudioWorkletNode(this.ctx, "pxtone-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.connect(this.ctx.destination);
    this.node.port.onmessage = (e: MessageEvent<WorkletToMain>) => this.onMessage(e.data);
  }

  private onMessage(msg: WorkletToMain): void {
    switch (msg.type) {
      case "loaded":
        this.totalSample = msg.totalSample;
        if (this.pendingLoad) {
          this.pendingLoad.resolve(msg.ok);
          this.pendingLoad = null;
        }
        this.opts.onLoaded?.(msg.ok, msg.totalSample);
        break;
      case "position":
        this.lastPosSample = msg.sample;
        this.lastPosTime = performance.now();
        this.opts.onPosition?.(msg.sample);
        break;
      case "ended":
        this.playing = false;
        this.lastPosSample = this.totalSample;
        this.opts.onEnded?.();
        break;
    }
  }

  async load(bytes: Uint8Array): Promise<boolean> {
    await this.init();
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const ok = await new Promise<boolean>((resolve) => {
      this.pendingLoad = { resolve };
      this.node!.port.postMessage({ type: "load", bytes: buf, sps: this.sps } satisfies MainToWorklet, [buf]);
    });
    return ok;
  }

  play(): void {
    this.playing = true;
    this.lastPosTime = performance.now();
    this.node?.port.postMessage({ type: "play" } satisfies MainToWorklet);
  }

  stop(): void {
    this.playing = false;
    this.node?.port.postMessage({ type: "stop" } satisfies MainToWorklet);
  }

  seek(sec: number): void {
    const sample = Math.trunc(Math.max(0, sec) * this.sps);
    this.node?.port.postMessage({ type: "seek", sample } satisfies MainToWorklet);
    this.lastPosSample = sample;
    this.lastPosTime = performance.now();
  }

  setLoop(loop: boolean): void {
    this.node?.port.postMessage({ type: "setLoop", loop } satisfies MainToWorklet);
  }

  setMasterVolume(volume: number): void {
    this.node?.port.postMessage({ type: "setMasterVolume", volume } satisfies MainToWorklet);
  }

  setMuteByUnit(mute: boolean): void {
    this.node?.port.postMessage({ type: "setMuteByUnit", mute } satisfies MainToWorklet);
  }

  // 現在の再生位置 (サンプル)。再生中は position 通知からの経過時間で補間する
  getCurrentSample(): number {
    if (!this.playing) return this.lastPosSample;
    const elapsed = (performance.now() - this.lastPosTime) / 1000;
    return Math.min(this.lastPosSample + elapsed * this.sps, this.totalSample);
  }

  dispose(): void {
    this.node?.disconnect();
    this.node = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }

  // オフライン全曲レンダリング (波形ピーク計算・WAV書き出し用の検証リファレンス)
  static renderOffline(bytes: Uint8Array, sps = 44100): { data: Int16Array; totalSample: number } | null {
    const s = new Service();
    if (s.init() !== PxtnErr.OK) return null;
    const io = new MemoryIo(bytes);
    if (s.read(io) !== PxtnErr.OK) return null;
    if (s.tonesReady() !== PxtnErr.OK) return null;
    s.setDestinationQuality(2, sps);
    // 検証リファレンスとして 1 周分をレンダリング (worklet と同一設定: ループなし)
    if (!s.mooPreparation({ startPosMeas: 0, startPosSample: 0, startPosFloat: 0, measEnd: 0, measRepeat: 0, fadeinSec: 0, flags: 0, masterVolume: 1.0 })) return null;
    const total = s.mooGetSamplingEnd();
    const out = new Int16Array(total * 2);
    for (let pos = 0; pos < total; pos += OFFLINE_CHUNK) {
      const n = Math.min(OFFLINE_CHUNK, total - pos);
      s.Moo(out.subarray(pos * 2), n);
    }
    return { data: out, totalSample: total };
  }
}
