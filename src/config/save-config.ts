import { writeFile } from "node:fs/promises";
import type { GhqWsConfig } from "./schema.js";
import { serializeConfig } from "./serialize-config.js";

export async function saveConfig(configPath: string, config: GhqWsConfig) {
  await writeFile(configPath, serializeConfig(configPath, config), "utf8");
}
