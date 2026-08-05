// ブラウザ再生テストページ用プレイヤー
// tsup で web/player.js にバンドルする (tsup.config.web.ts)

import { Service } from "../src/service.js";
import { MemoryIo } from "../src/data.js";
import { PxtnErr, pxtnErrorGetString } from "../src/error.js";

const SAMPLE_PATH = "./sample.ptcop";
const CHUNK = 44100;

let audioCtx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let buffer: AudioBuffer | null = null;
let songName = "";
let totalSec = 0;
let playOffsetSec = 0;
let startCtxTime = 0;
let rafId = 0;
let waveCanvas: HTMLCanvasElement | null = null;

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

function log(msg: string): void {
  status.textContent = msg;
}

// 波形をオフスクリーンキャンバスに一度だけ描画する
function drawWaveToOffscreen(buffer: AudioBuffer): void {
  const w = canvas.width;
  const h = canvas.height;
  if (!waveCanvas) waveCanvas = document.createElement("canvas");
  waveCanvas.width = w;
  waveCanvas.height = h;
  const ctx = waveCanvas.getContext("2d")!;
  const data = buffer.getChannelData(0);
  const len = data.length;
  const peak = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    const start = Math.trunc((i * len) / w);
    const end = Math.trunc(((i + 1) * len) / w);
    let max = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(data[j]!);
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

// 波形 (オフスクリーン) を貼り付けてカーソルを描画
function redrawWave(): void {
  canvasCtx.fillStyle = "#111";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  if (waveCanvas) canvasCtx.drawImage(waveCanvas, 0, 0);
  drawCursor();
}

function drawCursor(): void {
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

async function loadAndRender(bytes: Uint8Array, name: string): Promise<void> {
  stopPlayback();

  log("読み込み中...");
  await new Promise((r) => setTimeout(r, 10));

  const s = new Service();
  const initErr = s.init();
  if (initErr !== PxtnErr.OK) {
    log(`init 失敗: ${pxtnErrorGetString(initErr)}`);
    return;
  }

  const io = new MemoryIo(bytes);
  const readErr = s.read(io);
  if (readErr !== PxtnErr.OK) {
    log(`読み込み失敗: ${pxtnErrorGetString(readErr)}`);
    return;
  }

  const readyErr = s.tonesReady();
  if (readyErr !== PxtnErr.OK) {
    log(`tone ready 失敗: ${pxtnErrorGetString(readyErr)}`);
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

  // チャンク毎に全曲レンダリング
  const out = new Int16Array(total * 2);
  const t0 = performance.now();
  for (let pos = 0; pos < total; pos += CHUNK) {
    const n = Math.min(CHUNK, total - pos);
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
}

function startPlayback(): void {
  if (!buffer || !audioCtx) return;
  stopPlayback();
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);
  src.onended = () => {
    // シーク・停止で破棄済みの source からの発火は無視
    if (source !== src) return;
    // 自然終了 (曲末): 停止状態のまま末尾に留める
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
  src.start(0, playOffsetSec);
  btnPlay.textContent = "⏸ 一時停止";
  tick();
}

function stopPlayback(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (source) {
    const old = source;
    source = null; // 先に null にして onended を無効化 (位置保持)
    try {
      old.stop();
    } catch {
      /* ignore */
    }
    old.disconnect();
  }
  btnPlay.textContent = "▶ 再生";
}

function tick(): void {
  if (!source || !audioCtx) return;
  playOffsetSec = audioCtx.currentTime - startCtxTime;
  if (playOffsetSec >= totalSec) playOffsetSec = totalSec;
  updateTime();
  redrawWave();
  rafId = requestAnimationFrame(tick);
}

btnPlay.addEventListener("click", () => {
  if (source) {
    stopPlayback();
  } else {
    // 曲末で停止中なら先頭から再生
    if (playOffsetSec >= totalSec - 0.05) playOffsetSec = 0;
    startPlayback();
  }
});

btnStop.addEventListener("click", () => {
  stopPlayback();
  playOffsetSec = 0;
  updateTime();
  redrawWave();
});

canvas.addEventListener("click", (e) => {
  if (!buffer) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  playOffsetSec = Math.max(0, Math.min(totalSec, ratio * totalSec));
  if (source) startPlayback();
  else {
    updateTime();
    redrawWave();
  }
});

btnSample.addEventListener("click", async () => {
  try {
    const res = await fetch(SAMPLE_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await loadAndRender(buf, "sample.ptcop");
  } catch (e) {
    log(`サンプル読み込み失敗: ${String(e)}`);
  }
});

fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  await loadAndRender(buf, f.name);
});

// 検証・自動化用: ?autoload=1 でページ読み込み時にサンプルを自動ロード
if (new URLSearchParams(location.search).has("autoload")) {
  btnSample.click();
}
// ?autoplay=1 でロード完了後に自動再生
if (new URLSearchParams(location.search).has("autoplay")) {
  const t = setInterval(() => {
    if (buffer && btnPlay.textContent.includes("再生")) {
      clearInterval(t);
      btnPlay.click();
    }
  }, 500);
}
