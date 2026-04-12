import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePortableConfig } from "./machine-paths.js";
import type { GhqWsConfig } from "./schema.js";
import { serializeConfig } from "./serialize-config.js";

export async function copyConfigToWorkspace(
  sourceConfigPath: string,
  config: GhqWsConfig,
) {
  const portableConfig = normalizePortableConfig(config);
  const destinationPath = path.join(
    config.workspaceRoot,
    path.basename(sourceConfigPath),
  );
  await mkdir(config.workspaceRoot, { recursive: true });
  await writeFile(
    destinationPath,
    serializeConfig(sourceConfigPath, portableConfig),
    "utf8",
  );
  return destinationPath;
}
