import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // d.ts は rollup-plugin-dts が TypeScript 7 非対応のため、tsc で別途生成する
  // (tsconfig.build.json + build スクリプト参照)
  dts: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
});
