import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG_BASENAME } from "../shared/constants.js";
import type { GhqWsConfig } from "./schema.js";
import { parseConfig } from "./validate-config.js";

const CONFIG_CANDIDATES = [
  `${DEFAULT_CONFIG_BASENAME}.json`,
  `${DEFAULT_CONFIG_BASENAME}.yaml`,
  `${DEFAULT_CONFIG_BASENAME}.yml`,
] as const;

export interface LoadedConfig {
  path: string;
  config: GhqWsConfig;
}

export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  for (const candidate of CONFIG_CANDIDATES) {
    const configPath = path.join(cwd, candidate);

    try {
      const raw = await readFile(configPath, "utf8");
      const parsed = candidate.endsWith(".json")
        ? JSON.parse(raw)
        : YAML.parse(raw);
      const config = parseConfig(parsed);
      return { path: configPath, config };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      if (error instanceof Error) {
        throw new Error(`invalid config at ${configPath}: ${error.message}`);
      }

      throw error;
    }
  }

  throw new Error(
    `config file not found. expected one of: ${CONFIG_CANDIDATES.join(", ")}`,
  );
}
