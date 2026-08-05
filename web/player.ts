// ブラウザ再生テストページ用プレイヤー
// デフォルト: AudioWorklet リアルタイム再生
// ?offline=1: オフライン全曲レンダリング + AudioBuffer 再生 (旧実装・検証リファレンス)

import { RealtimePlayer } from "./realtime-player.js";
import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr } from "../src/error.js";

const SAMPLE_PATH = "./sample.ptcop";
const params = new URLSearchParams(location.search);
const OFFLINE_MODE = params.has("offline");

// ---- DOM ----
const fileInput = document.getElementById("file") as HTMLInputElement;
const btnSample = document.getElementById("btn-sample") as HTMLButtonElement;
const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const songTitle = document.getElementById("song-title") as HTMLDivElement;
const status = document.getElementById("status") as HTMLDivElement;
const timeLabel = document.getElementById("time") as HTMLDivElement;
const canvas = document.getElementById("wave") as HTMLCanvasElement;
const canvasCtx = canvas.getContext("2d")!;

// ---- 共通状態 ----
let songName = "";
let totalSec = 0;
let playOffsetSec = 0;
let songLoaded = false;
let rafId = 0;
let waveCanvas: HTMLCanvasElement | null = null;

// ---- オフライン (AudioBuffer) モード状態 ----
let audioCtx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let buffer: AudioBuffer | null = null;
let startCtxTime = 0;

// ---- リアルタイムモード状態 ----
let player: RealtimePlayer | null = null;

function log(msg: string): void {
  status.textContent = msg;
}

// 波形 (オフスクリーンキャンバス) を貼り付けてカーソルを描画
function redrawWave(): void {
  canvasCtx.fillStyle = "#111";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  if (waveCanvas) canvasCtx.drawImage(waveCanvas, 0, 0);
  drawCursor();
}

function drawCursor(): void {
  if (!totalSec) return;
  canvasCtx.fillStyle = "#f44";
  const x = Math.trunc((playOffsetSec / totalSec) * canvas.width);
  canvasCtx.fillRect(x - 1, 0, 2, canvas.height);
}

function updateTime(): void {
  const t = Math.min(playOffsetSec, totalSec);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  timeLabel.textContent = `${m}:${String(s).padStart(2, "0")} / ${Math.floor(totalSec / 60)}:${String(Math.floor(totalSec % 60)).padStart(2, "0")}`;
}

// ピークを計算してオフスクリーンキャンバスへ描画する
function drawPeaks(peakAt: (sampleIdx: number) => number, totalSample: number): void {
  const w = canvas.width;
  const h = canvas.height;
  if (!waveCanvas) waveCanvas = document.createElement("canvas");
  waveCanvas.width = w;
  waveCanvas.height = h;
  const ctx = waveCanvas.getContext("2d")!;
  const peak = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    const start = Math.trunc((i * totalSample) / w);
    const end = Math.trunc(((i + 1) * totalSample) / w);
    let max = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(peakAt(j));
      if (a > max) max = a;
    }
    peak[i] = max;
  }
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#4af";
  for (let i = 0; i < w; i++) {
    const ph = Math.max(1, Math.trunc(peak[i]! * (h / 2)));
    ctx.fillRect(i, h / 2 - ph, 1, ph * 2);
  }
}

// 全曲ピークをオフスクリーンキャンバスに描画 (Int16 レンダリング結果から)
function drawPeaksToOffscreen(data: Int16Array, totalSample: number): void {
  drawPeaks((j) => data[j * 2]! / 32768, totalSample);
}

// ================= オフライン (AudioBuffer) モード =================

function drawWaveToOffscreen(ab: AudioBuffer): void {
  const data = ab.getChannelData(0);
  drawPeaks((j) => data[j]!, data.length);
}

function offlineStartPlayback(): void {
  if (!buffer || !audioCtx) return;
  offlineStopPlayback();
  const seekBase = playOffsetSec;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.onended = () => {
    if (source !== src) return;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    source = null;
    playOffsetSec = totalSec;
    btnPlay.textContent = "▶ 再生";
    updateTime();
    redrawWave();
  };
  source = src;
  startCtxTime = audioCtx.currentTime;
  src.start(0, seekBase);
  btnPlay.textContent = "⏸ 一時停止";
  offlineTick(seekBase);
}

function offlineStopPlayback(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (source) {
    const old = source;
    source = null;
    try {
      old.stop();
    } catch {
      /* ignore */
    }
    old.disconnect();
  }
  btnPlay.textContent = "▶ 再生";
}

function offlineTick(seekBase: number): void {
  if (!source || !audioCtx) return;
  playOffsetSec = seekBase + (audioCtx.currentTime - startCtxTime);
  if (playOffsetSec >= totalSec) playOffsetSec = totalSec;
  updateTime();
  redrawWave();
  rafId = requestAnimationFrame(() => offlineTick(seekBase));
}

async function loadOffline(bytes: Uint8Array, name: string): Promise<void> {
  offlineStopPlayback();
  log("読み込み中...");
  await new Promise((r) => setTimeout(r, 10));

  const s = new Service();
  const initErr = s.init();
  if (initErr !== PxtnErr.OK) {
    log(`init 失敗: ${initErr}`);
    return;
  }
  const io = new MemoryIo(bytes);
  if (s.read(io) !== PxtnErr.OK) {
    log("読み込み失敗 (read)");
    return;
  }
  if (s.tonesReady() !== PxtnErr.OK) {
    log("読み込み失敗 (tonesReady)");
    return;
  }
  s.setDestinationQuality(2, 44100);
  if (!s.mooPreparation(null)) {
    log("レンダリング準備失敗");
    return;
  }

  const total = s.mooGetSamplingEnd();
  songName = name;
  totalSec = total / 44100;
  log(`レンダリング中... (${totalSec.toFixed(1)}秒, ${s.woiceNum}ボイス, ${s.unitNum}ユニット)`);
  songTitle.textContent = name;

  const out = new Int16Array(total * 2);
  const t0 = performance.now();
  for (let pos = 0; pos < total; pos += 44100) {
    const n = Math.min(44100, total - pos);
    s.Moo(out.subarray(pos * 2), n);
  }
  const ms = performance.now() - t0;
  log(`レンダリング完了 (${(ms / 1000).toFixed(1)}秒) — 再生できます`);

  if (!audioCtx) audioCtx = new AudioContext();
  const ab = audioCtx.createBuffer(2, total, 44100);
  for (let ch = 0; ch < 2; ch++) {
    const data = ab.getChannelData(ch);
    for (let i = 0; i < total; i++) data[i] = out[i * 2 + ch]! / 32768;
  }
  buffer = ab;
  playOffsetSec = 0;
  drawWaveToOffscreen(ab);
  redrawWave();
  updateTime();
  songLoaded = true;
}

// ================= リアルタイム (AudioWorklet) モード =================

function rtIsPlaying(): boolean {
  return player?.isPlaying ?? false;
}

function rtPlay(): void {
  if (!player) return;
  // 曲末で停止中なら先頭から
  if (playOffsetSec >= totalSec - 0.05) {
    player.seek(0);
    playOffsetSec = 0;
  }
  player.play();
  btnPlay.textContent = "⏸ 一時停止";
  rtTick();
}

function rtStop(): void {
  player?.stop();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  btnPlay.textContent = "▶ 再生";
}

function rtTick(): void {
  if (!player?.isPlaying) return;
  playOffsetSec = player.getCurrentSample() / player.sampleRate;
  if (playOffsetSec >= totalSec) playOffsetSec = totalSec;
  updateTime();
  redrawWave();
  rafId = requestAnimationFrame(rtTick);
}

async function loadRealtime(bytes: Uint8Array, name: string): Promise<void> {
  rtStop();
  log("読み込み中...");
  try {
    if (!player) {
      player = new RealtimePlayer({
        onEnded: () => {
          playOffsetSec = totalSec;
          btnPlay.textContent = "▶ 再生";
          updateTime();
          redrawWave();
        },
      });
      await player.init();
    }
  } catch (e) {
    log(`AudioWorklet 初期化失敗: ${String(e)}`);
    return;
  }

  const ok = await player.load(bytes);
  if (!ok) {
    log("読み込み失敗 (worklet)");
    return;
  }

  // 波形ピークはオフラインで事前計算 (検証リファレンスと同じコードパス)
  log("波形計算中...");
  const off = RealtimePlayer.renderOffline(bytes, player.sampleRate);
  if (off) {
    totalSec = off.totalSample / player.sampleRate;
    drawPeaksToOffscreen(off.data, off.totalSample);
  } else {
    totalSec = player.durationSec;
  }
  songName = name;
  songTitle.textContent = name;
  playOffsetSec = 0;
  redrawWave();
  updateTime();
  songLoaded = true;
  log("読み込み完了 — 再生できます");
}

// ================= 共通 UI =================

function loadSong(bytes: Uint8Array, name: string): void {
  if (OFFLINE_MODE) void loadOffline(bytes, name);
  else void loadRealtime(bytes, name);
}

btnPlay.addEventListener("click", () => {
  if (OFFLINE_MODE) {
    if (source) offlineStopPlayback();
    else {
      if (playOffsetSec >= totalSec - 0.05) playOffsetSec = 0;
      offlineStartPlayback();
    }
  } else {
    if (rtIsPlaying()) rtStop();
    else rtPlay();
  }
});

btnStop.addEventListener("click", () => {
  if (OFFLINE_MODE) {
    offlineStopPlayback();
    playOffsetSec = 0;
    updateTime();
    redrawWave();
  } else {
    rtStop();
    player?.seek(0);
    playOffsetSec = 0;
    updateTime();
    redrawWave();
  }
});

canvas.addEventListener("click", (e) => {
  if (!songLoaded) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  playOffsetSec = Math.max(0, Math.min(totalSec, ratio * totalSec));
  if (OFFLINE_MODE) {
    if (source) offlineStartPlayback();
    else {
      updateTime();
      redrawWave();
    }
  } else {
    player?.seek(playOffsetSec);
    if (player?.isPlaying) {
      playOffsetSec = player.getCurrentSample() / player.sampleRate;
    }
    updateTime();
    redrawWave();
  }
});

btnSample.addEventListener("click", async () => {
  try {
    const res = await fetch(SAMPLE_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    loadSong(buf, "sample.ptcop");
  } catch (e) {
    log(`サンプル読み込み失敗: ${String(e)}`);
  }
});

fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  loadSong(buf, f.name);
});

// 検証・自動化用: ?autoload=1 でページ読み込み時にサンプルを自動ロード
if (params.has("autoload")) {
  btnSample.click();
}
// ?autoplay=1 でロード完了後に自動再生
if (params.has("autoplay")) {
  const t = setInterval(() => {
    if (songLoaded && btnPlay.textContent.includes("再生")) {
      clearInterval(t);
      btnPlay.click();
    }
  }, 500);
}
