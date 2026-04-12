import { writeFile } from "node:fs/promises";
import { normalizePortableConfig } from "./machine-paths.js";
import type { GhqWsConfig } from "./schema.js";
import { serializeConfig } from "./serialize-config.js";

export async function saveConfig(configPath: string, config: GhqWsConfig) {
  await writeFile(
    configPath,
    serializeConfig(configPath, normalizePortableConfig(config)),
    "utf8",
  );
}
