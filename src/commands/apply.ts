import { copyConfigToWorkspace } from "../config/copy-config-to-workspace.js";
import { loadConfig } from "../config/load-config.js";
import { getRuntimePaths } from "../config/machine-paths.js";
import { ensureRepos } from "../ghq/ensure-repos.js";
import { runSync } from "./sync.js";

export interface ApplyResult {
  configPath: string;
  workspaceRoot: string;
  linkedCount: number;
  skippedCount: number;
  copiedResourcesCount: number;
  codeWorkspacePath: string | null;
  copiedConfigPath: string;
  fetchedRepos: string[];
  alreadyPresentRepos: string[];
}

export async function runApply(cwd = process.cwd()): Promise<ApplyResult> {
  const loaded = await loadConfig(cwd);
  const runtimePaths = await getRuntimePaths(loaded.config);
  const runtimeConfig = {
    ...loaded.config,
    ghqRoot: runtimePaths.resolvedGhqRoot,
    workspaceRoot: runtimePaths.resolvedWorkspaceRoot,
  };
  const ensuredRepos = await ensureRepos(runtimeConfig);
  const syncResult = await runSync(cwd, runtimeConfig);
  const copiedConfigPath = await copyConfigToWorkspace(
    loaded.path,
    runtimeConfig,
  );

  return {
    ...syncResult,
    copiedConfigPath,
    fetchedRepos: ensuredRepos.fetched,
    alreadyPresentRepos: ensuredRepos.alreadyPresent,
  };
}
