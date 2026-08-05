import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["web/player.ts"],
  format: ["esm"],
  outDir: "web",
  outExtension: () => ({ js: ".js" }),
  target: "es2022",
  sourcemap: false,
  clean: false,
  external: [],
});
