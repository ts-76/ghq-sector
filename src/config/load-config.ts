import { readFile, stat } from "node:fs/promises";
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
  const directPath = await loadConfigFile(cwd);
  if (directPath) {
    return directPath;
  }

  for (const candidate of CONFIG_CANDIDATES) {
    const configPath = path.join(cwd, candidate);
    const loaded = await loadConfigFile(configPath);

    if (loaded) {
      return loaded;
    }
  }

  throw new Error(
    `config file not found. expected one of: ${CONFIG_CANDIDATES.join(", ")}`,
  );
}

async function loadConfigFile(
  configPath: string,
): Promise<LoadedConfig | null> {
  const fileStat = await statConfigPath(configPath);
  if (!fileStat) {
    return null;
  }

  if (!fileStat.isFile()) {
    return null;
  }

  const isJson = configPath.endsWith(".json");
  const isYaml = configPath.endsWith(".yaml") || configPath.endsWith(".yml");
  if (!isJson && !isYaml) {
    return null;
  }

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = isJson ? JSON.parse(raw) : YAML.parse(raw);
    const config = parseConfig(parsed);
    return { path: configPath, config };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    if (error instanceof Error) {
      throw new Error(`invalid config at ${configPath}`, { cause: error });
    }

    throw error;
  }
}

async function statConfigPath(configPath: string) {
  try {
    return await stat(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
