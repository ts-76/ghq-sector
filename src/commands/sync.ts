import path from "node:path";
import { resolveConfigForCurrentMachine } from "../config/machine-paths.js";
import { loadConfig } from "../config/load-config.js";
import type { GhqWsConfig } from "../config/schema.js";
import { copyResources } from "../resources/copy-resources.js";
import { info, success, warn } from "../shared/logger.js";
import { generateCodeWorkspace } from "../workspace/generate-code-workspace.js";
import { syncWorkspace } from "../workspace/sync-workspace.js";

export interface RunSyncResult {
  configPath: string;
  workspaceRoot: string;
  linkedCount: number;
  skippedCount: number;
  copiedResourcesCount: number;
  codeWorkspacePath: string | null;
}

export async function runSync(
  cwd = process.cwd(),
  runtimeConfig?: GhqWsConfig,
): Promise<RunSyncResult> {
  const loaded = await loadConfig(cwd);
  info(`loaded config: ${loaded.path}`);

  const config = runtimeConfig ?? (await resolveConfigForCurrentMachine(loaded.config));
  const result = await syncWorkspace(config);
  const copiedResources = await copyResources(config, path.dirname(loaded.path));
  const codeWorkspacePath = await generateCodeWorkspace(config);

  success(`synced workspace: ${result.workspaceRoot}`);
  success(`linked repos: ${result.linked.length}`);
  if (result.skipped.length > 0) {
    warn(`skipped repos: ${result.skipped.length}`);
  }
  if (copiedResources.length > 0) {
    success(`copied resources: ${copiedResources.length}`);
  }
  if (codeWorkspacePath) {
    success(`generated code workspace: ${codeWorkspacePath}`);
  }

  return {
    configPath: loaded.path,
    workspaceRoot: result.workspaceRoot,
    linkedCount: result.linked.length,
    skippedCount: result.skipped.length,
    copiedResourcesCount: copiedResources.length,
    codeWorkspacePath: codeWorkspacePath ?? null,
  };
}
