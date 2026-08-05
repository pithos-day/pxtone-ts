# pxtone-ts

[ピストンコラージュ](https://pxtone.org/) のオーディオエンジンを TypeScript に移植した Web 版実装です。

C++ 版ソース([pxtone-source-code 220910a](https://pxtone.org/developer/))を基準に、ptcopファイルの読み書きと再生（レンダリング）を JavaScript で再現します。

## 特徴

- ピストンコラージュ互換の ptcop / pttune ファイルを読み込み・再生
- トラック（unit）、ボイス（PCM / PTV / PTN）、イベント、エフェクト（delay / overdrive）に対応
- **AudioWorklet によるリアルタイム再生**（オフラインと同一のレンダリングコードパス）
- ブラウザで再生できるテストページ付き（波形表示・シーク対応）

## 使い方

### テストページ

```bash
pnpm build:web   # web/player.ts と worklet をバンドル
pnpm dev:web     # http://localhost:8080/ で起動
```

ブラウザで開き、「サンプル曲を読み込む」ボタンまたは ptcop ファイルの選択で再生できます。
エンジンは AudioWorklet スレッドで動作し、再生はリアルタイムに行われます（波形は読み込み時に
オフラインでピークを事前計算）。`?offline=1` を付けると、従来の全曲レンダリング
+ AudioBuffer 再生方式（検証リファレンス）で動作します。

### テスト・型チェック

```bash
pnpm test           # vitest（54 テスト）
pnpm test:realtime  # オフライン/オンライン出力の一致テスト（chromium ヘッドレス）
pnpm typecheck      # tsc --noEmit
```

### ライブラリビルド

```bash
pnpm build       # tsup (dist/)
```

## 移植済みモジュール

| モジュール | 対応 C++ ソース |
|---|---|
| `src/data.ts` | pxtnData（IO・varint） |
| `src/event.ts` / `src/evelist.ts` / `src/master.ts` / `src/text.ts` | イベント・曲メタ |
| `src/delay.ts` / `src/overdrive.ts` | エフェクト |
| `src/frequency.ts` / `src/osc.ts` / `src/pcm.ts` | 音源基盤 |
| `src/noise.ts` / `src/noise-builder.ts` | PTN（ノイズボイス） |
| `src/woice.ts` / `src/unit.ts` | ボイス定義・発音状態 |
| `src/service.ts` | ptcop 読み書き + Moo レンダラー |
| `src/worklet/messages.ts` | worklet⇔メインのメッセージ型 |
| `web/player-worklet.ts` / `web/realtime-player.ts` | AudioWorklet プレイヤー / メインスレッド側ラッパー |

## 既知の制限

- **OGGV ボイス非対応**: C++ 側でもオプション機能（`pxINCLUDE_OGGVORBIS`）であり、デフォルトビルドでは無効。未対応ファイルは `OGG_NO_SUPPORTED` を返す
- **x1x 形式非対応**: 古いフォーマットは読み込み不可（C++ と同じ挙動）
- **単音プレビュー未実装**: DAW 用の即時発音トリガはメッセージスキーマのみ定義

## 謝辞

ピストンコラージュ及び移植元のライブラリの開発者である[開発室Pixel](https://studiopixel.jp)氏に感謝。
