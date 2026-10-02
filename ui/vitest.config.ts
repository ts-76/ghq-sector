import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ["browser"],
    alias: {
      "@internal/ui": fileURLToPath(
        new URL("./src/visual-json-internal.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
  },
});
