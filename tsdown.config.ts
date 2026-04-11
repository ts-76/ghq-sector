import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/main.ts"],
  format: "esm",
  outDir: "dist/cli",
  target: "node20",
  clean: true,
  sourcemap: false,
  dts: false,
  shims: false,
  platform: "node",
  external: [],
});
