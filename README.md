# pxtone-ts

[ピストンコラージュ](https://pxtone.org/) の C++ オーディオエンジンを TypeScript に移植したパッケージです。

ptcop / pttune ファイルの読み書き・再生を JavaScript/TypeScript で実行します。AudioWorklet によるリアルタイム再生にも対応しています。

## 特徴

- ptcop / pttune ファイルの読み込み・書き出し・再生（C++ 版との出力一致を検証済み）
- ボイス形式: PCM / PTV / PTN / OGG Vorbis（OGGV は WASM デコーダでデコード後に再生）
- AudioWorklet によるリアルタイム再生（Moo レンダラー、オフラインと同一コードパス）
- ブラウザ テストページ付属（波形表示・シーク対応）

## 使い方

```bash
pnpm add github:tauerie/pxtone-ts
```

```ts
import { Service, PxtnErr, MemoryIo, defaultOggvDecoder } from "pxtone-ts";

const bytes = new Uint8Array(await fetch("./song.ptcop").then(r => r.arrayBuffer()));
const service = new Service();
service.init();
service.read(new MemoryIo(bytes));
await service.decodeOggvAll(defaultOggvDecoder);
service.setDestinationQuality(2, 44100);
service.mooPreparation({ startPosMeas: 0, measEnd: 0, measRepeat: 0, fadeinSec: 0, flags: 1, masterVolume: 1 });

const buf = new Uint8Array(4096);
while (service.moo(buf, buf.length)) {
  // buf に int16 PCM が格納される
}
```

### テストページ

```bash
pnpm build:web   # AudioWorklet + プレイヤーをバンドル
pnpm dev:web     # http://localhost:8080/ でサーバー起動
```

ブラウザで開き、ボタンまたはドラッグ＆ドロップで再生できます。`?offline=1` でオフライン検証モードになります。

## テスト・型チェック・ビルド

```bash
pnpm test           # vitest（65 テスト）
pnpm typecheck      # tsc --noEmit
pnpm build          # tsup で dist/ 生成（ESM + CJS + d.ts）
pnpm test:realtime  # オフライン/オンライン完全一致テスト（chromium ヘッドレス）
```

## 既知の制限

- **x1x 形式非対応**: 古いフォーマットは読み込み不可（C++ と同じ挙動）
- **単音プレビュー未実装**: DAW 用の即時発音トリガはメッセージスキーマのみ

## 依存関係

[@wasm-audio-decoders/ogg-vorbis](https://github.com/eshaz/wasm-audio-decoders)（MIT）を介して LGPL-3.0 の codec-parser を使用。詳細は [LICENSES.md](LICENSES.md) を参照。

## 謝辞

ピストンコラージュ及び移植元のライブラリの開発者である[開発室Pixel](https://studiopixel.jp)氏に感謝。
