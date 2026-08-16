import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    player: "web/player.ts",
    "player-worklet": "web/player-worklet.ts",
    "verify-realtime": "web/verify-realtime.ts",
  },
  format: ["esm"],
  outDir: "web",
  outExtension: () => ({ js: ".js" }),
  target: "es2022",
  // 依存パッケージの browser エントリ (例: @eshaz/web-worker) を解決する
  platform: "browser",
  sourcemap: false,
  clean: false,
  splitting: false,
  external: [],
  // dependencies はデフォルトで外部化されるため、ブラウザで使うものは明示的にバンドルする
  noExternal: ["@wasm-audio-decoders/ogg-vorbis", "@wasm-audio-decoders/common", "codec-parser"],
});
