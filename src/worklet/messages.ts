// AudioWorklet プロセッサとメインスレッド間のメッセージ型定義
// 双方 (worklet / RealtimePlayer / 将来のDAW) から参照する共通スキーマ。

// Main → Worklet
export type MainToWorklet =
  | { type: "load"; bytes: ArrayBuffer; sps: number }
  | { type: "play" }
  | { type: "stop" }
  | { type: "seek"; sample: number }
  | { type: "setLoop"; loop: boolean }
  | { type: "setMasterVolume"; volume: number }
  | { type: "setMuteByUnit"; mute: boolean }
  // 単音プレビュー (DAW用の即時発音トリガ)。スキーマ定義のみで、
  // 実際の発音合成は将来実装する。
  | { type: "preview"; unitNo: number; voiceNo: number; key: number; velocity: number };

// Worklet → Main
export type WorkletToMain =
  | { type: "loaded"; ok: boolean; error: string; totalSample: number }
  | { type: "position"; sample: number }
  | { type: "ended" };
