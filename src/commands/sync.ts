import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { resolveConfigForCurrentMachine } from "../config/machine-paths.js";
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
  agentSkills: {
    linkedCount: number;
    duplicateCount: number;
    warningCount: number;
    reports: {
      json: string;
      markdown: string;
    };
    byProvider: {
      agents: { linkedCount: number };
      claude: { linkedCount: number };
    };
  };
}

export async function runSync(
  cwd = process.cwd(),
  runtimeConfig?: GhqWsConfig,
): Promise<RunSyncResult> {
  const loaded = await loadConfig(cwd);
  info(`loaded config: ${loaded.path}`);

  const config =
    runtimeConfig ?? (await resolveConfigForCurrentMachine(loaded.config));
  const result = await syncWorkspace(config);
  const copiedResources = await copyResources(
    config,
    path.dirname(loaded.path),
  );
  const codeWorkspacePath = await generateCodeWorkspace(config);

  success(`synced workspace: ${result.workspaceRoot}`);
  success(`linked repos: ${result.linked.length}`);
  if (result.skipped.length > 0) {
    warn(`skipped repos: ${result.skipped.length}`);
  }
  if (result.agentSkills.linked.length > 0) {
    success(
      `linked .agents skills: ${result.agentSkills.byProvider.agents.linkedCount}`,
    );
    success(
      `linked .claude skills: ${result.agentSkills.byProvider.claude.linkedCount}`,
    );
  }
  if (result.agentSkills.duplicateCount > 0) {
    warn(
      `skipped duplicate agent skills: ${result.agentSkills.duplicateCount}`,
    );
  }
  if (result.agentSkills.warningCount > 0) {
    warn(`agent skill warnings: ${result.agentSkills.warningCount}`);
  }
  if (
    result.agentSkills.linked.length > 0 ||
    result.agentSkills.duplicateCount > 0
  ) {
    success(`agent skills report: ${result.agentSkills.reports.markdown}`);
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
    agentSkills: {
      linkedCount: result.agentSkills.linked.length,
      duplicateCount: result.agentSkills.duplicateCount,
      warningCount: result.agentSkills.warningCount,
      reports: result.agentSkills.reports,
      byProvider: result.agentSkills.byProvider,
    },
  };
}
