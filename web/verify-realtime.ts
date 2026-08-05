// オフライン (Service.Moo 全曲) とオンライン (OfflineAudioContext + AudioWorklet) の
// 出力一致検証ページ。結果を #result に JSON で出力する。

import type { WorkletToMain } from "../src/worklet/messages.js";
import { renderOffline } from "./offline-render.js";

const SPS = 44100;
const SONGS = [
  "sample.ptcop",
  "5LOVE[Quois].ptcop",
  "Aisatsu[Rusk].ptcop",
  "ComputerXXsan[gensai].ptcop",
  "Fuwafuwa[PEPO].ptcop",
  "overworld2_nes[Se-ko].ptcop",
  "overworld2_orche[Se-ko].ptcop",
];

interface SongResult {
  name: string;
  ok: boolean;
  error?: string;
  maxDiff: number;
  diffCount: number;
  total: number;
}

const resultEl = document.getElementById("result") as HTMLPreElement;
const results: SongResult[] = [];

function setResult(): void {
  const json = JSON.stringify({ done: results.length === SONGS.length, songs: results });
  resultEl.textContent = json;
  if (results.length === SONGS.length) {
    // 検証ドライバ (chromium 起動テスト) へ結果を送信
    void fetch("/result", { method: "POST", body: json });
  }
}

async function renderOnline(bytes: ArrayBuffer, total: number): Promise<Float32Array[] | null> {
  const ctx = new OfflineAudioContext(2, total, SPS);
  await ctx.audioWorklet.addModule("./player-worklet.js");
  const node = new AudioWorkletNode(ctx, "pxtone-player", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.connect(ctx.destination);
  const loaded = new Promise<boolean>((resolve) => {
    node.port.onmessage = (e: MessageEvent<WorkletToMain>) => {
      if (e.data.type === "loaded") resolve(e.data.ok);
    };
  });
  node.port.postMessage({ type: "load", bytes, sps: SPS }, [bytes]);
  if (!(await loaded)) return null;
  node.port.postMessage({ type: "play" });

  // この環境の OfflineAudioContext は旧 API (startRendering + oncomplete) のみ対応
  const rendered = await new Promise<AudioBuffer>((resolve, reject) => {
    const off = ctx as unknown as {
      startRendering(): void;
      oncomplete: ((e: { renderedBuffer: AudioBuffer }) => void) | null;
    };
    off.oncomplete = (e) => resolve(e.renderedBuffer);
    off.startRendering();
    setTimeout(() => reject(new Error("render timeout")), 120000);
  });
  return [rendered.getChannelData(0), rendered.getChannelData(1)];
}

function compare(offline: Int16Array, online: Float32Array[]): { maxDiff: number; diffCount: number; total: number } {
  const L = online[0]!;
  const R = online[1]!;
  const total = Math.min(L.length, Math.trunc(offline.length / 2));
  let maxDiff = 0;
  let diffCount = 0;
  for (let i = 0; i < total; i++) {
    const refL = offline[i * 2]! / 32768;
    const refR = offline[i * 2 + 1]! / 32768;
    const dL = Math.abs(refL - L[i]!);
    const dR = Math.abs(refR - R[i]!);
    if (dL > maxDiff) maxDiff = dL;
    if (dR > maxDiff) maxDiff = dR;
    if (dL > 0) diffCount++;
    if (dR > 0) diffCount++;
  }
  return { maxDiff, diffCount, total };
}

async function main(): Promise<void> {
  for (const name of SONGS) {
    const res = await fetch(`./fixtures/${name}`);
    if (!res.ok) {
      results.push({ name, ok: false, error: `HTTP ${res.status}`, maxDiff: -1, diffCount: 0, total: 0 });
      setResult();
      continue;
    }
    const ab = await res.arrayBuffer();
    const offline = renderOffline(new Uint8Array(ab.slice(0)), SPS);
    if (!offline) {
      results.push({ name, ok: false, error: "offline render failed", maxDiff: -1, diffCount: 0, total: 0 });
      setResult();
      continue;
    }
    const online = await renderOnline(ab.slice(0), offline.totalSample).catch((e: unknown) => {
      results.push({ name, ok: false, error: `online render failed: ${String(e)}`, maxDiff: -1, diffCount: 0, total: 0 });
      setResult();
      return null;
    });
    if (!online) continue;
    const cmp = compare(offline.data, online);
    results.push({ name, ok: cmp.maxDiff === 0, maxDiff: cmp.maxDiff, diffCount: cmp.diffCount, total: cmp.total });
    setResult();
  }
}

void main();
