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
  sourcemap: false,
  clean: false,
  splitting: false,
  external: [],
});
