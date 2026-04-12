import type { GhqWsConfig } from "./schema.js";
import { getGhqRoot } from "../shared/ghq.js";
import {
  applyResolvedRuntimePaths,
  collapseHome,
  resolveRuntimePaths,
} from "../shared/paths.js";

export async function resolveConfigForCurrentMachine(
  config: GhqWsConfig,
): Promise<GhqWsConfig> {
  return applyResolvedRuntimePaths(config, await getRuntimePaths(config));
}

export async function getRuntimePaths(config: GhqWsConfig) {
  try {
    return resolveRuntimePaths(config, await getGhqRoot());
  } catch {
    return resolveRuntimePaths(config);
  }
}

export function normalizePortableConfig(config: GhqWsConfig): GhqWsConfig {
  const ghqRoot = collapseHome(config.ghqRoot);
  const workspaceRoot = collapseHome(config.workspaceRoot);

  if (ghqRoot === config.ghqRoot && workspaceRoot === config.workspaceRoot) {
    return config;
  }

  return {
    ...config,
    ghqRoot,
    workspaceRoot,
  };
}
