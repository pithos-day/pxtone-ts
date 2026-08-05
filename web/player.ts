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

function drawWave(buffer: AudioBuffer): void {
  const w = canvas.width;
  const h = canvas.height;
  const data = buffer.getChannelData(0);
  const len = data.length;
  const peak = new Int16Array(w);
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
  canvasCtx.fillStyle = "#111";
  canvasCtx.fillRect(0, 0, w, h);
  canvasCtx.fillStyle = "#4af";
  for (let i = 0; i < w; i++) {
    const ph = Math.max(1, Math.trunc(peak[i]! * (h / 2)));
    canvasCtx.fillRect(i, h / 2 - ph, 1, ph * 2);
  }
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
  drawWave(ab);
  updateTime();
}

function startPlayback(): void {
  if (!buffer || !audioCtx) return;
  stopPlayback();
  source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  startCtxTime = audioCtx.currentTime;
  source.start(0, playOffsetSec);
  source.onended = () => {
    if (playOffsetSec >= totalSec - 0.05) {
      playOffsetSec = 0;
      updateTime();
      drawCursor();
      btnPlay.textContent = "▶ 再生";
    }
  };
  btnPlay.textContent = "⏸ 一時停止";
  tick();
}

function stopPlayback(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (source) {
    try {
      source.stop();
    } catch {
      /* ignore */
    }
    source.disconnect();
    source = null;
  }
  btnPlay.textContent = "▶ 再生";
}

function tick(): void {
  if (!source || !audioCtx) return;
  playOffsetSec = audioCtx.currentTime - startCtxTime;
  if (playOffsetSec >= totalSec) playOffsetSec = totalSec;
  updateTime();
  canvasCtx.fillStyle = "#111";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  drawWave(buffer!);
  drawCursor();
  rafId = requestAnimationFrame(tick);
}

btnPlay.addEventListener("click", () => {
  if (source) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

btnStop.addEventListener("click", () => {
  stopPlayback();
  playOffsetSec = 0;
  updateTime();
});

canvas.addEventListener("click", (e) => {
  if (!buffer) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  playOffsetSec = Math.max(0, Math.min(totalSec - 0.01, ratio * totalSec));
  if (source) startPlayback();
  else {
    updateTime();
    canvasCtx.fillStyle = "#111";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    drawWave(buffer);
    drawCursor();
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
