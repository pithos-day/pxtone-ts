# pxtone-ts

[ピストンコラージュ](https://pxtone.org/) の C++ オーディオエンジンを TypeScript に移植したパッケージです。

ptcop / pttune ファイルの読み書き・再生を JavaScript/TypeScript で実行します。AudioWorklet によるリアルタイム再生にも対応しています。

## 特徴

- ptcop / pttune ファイルの読み込み・書き出し・再生（C++ 版との出力一致を検証済み）
- ボイス形式: PCM / PTV / PTN / OGG Vorbis（OGGV は WASM デコーダでデコード後に再生）
- AudioWorklet によるリアルタイム再生（Moo レンダラー、オフラインと同一コードパス）
- ブラウザ テストページ付属（波形表示・シーク対応）

## 使い方

### テストページ

```bash
pnpm build:web   # AudioWorklet + プレイヤーをバンドル
pnpm dev:web     # http://localhost:8080/ でサーバー起動
```

ブラウザで開き、ボタンまたはドラッグ＆ドロップで再生できます。`?offline=1` でオフライン検証モードになります。

## テスト・型チェック・ビルド

```bash
pnpm test           # vitest（64 テスト。ブラウザ検証は含まない）
pnpm typecheck      # tsc --noEmit
pnpm build          # tsup で dist/ 生成（ESM + CJS + d.ts）
pnpm test:realtime  # 完全一致テスト（要 pnpm build:web、chromium ヘッドレス）
```

## 謝辞

ピストンコラージュ及び移植元のライブラリの開発者である[開発室Pixel](https://studiopixel.jp)氏に感謝。
