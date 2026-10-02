import { copyConfigToWorkspace } from "../config/copy-config-to-workspace.js";
import { loadConfig } from "../config/load-config.js";
import { getRuntimePaths } from "../config/machine-paths.js";
import { ensureRepos } from "../ghq/ensure-repos.js";
import { ApplyError, type ApplyStage } from "./apply-progress.js";
import { runSync } from "./sync.js";

export { ApplyError } from "./apply-progress.js";

export interface ApplyResult {
  configPath: string;
  workspaceRoot: string;
  linkedCount: number;
  skippedCount: number;
  copiedResourcesCount: number;
  codeWorkspacePath: string | null;
  agentsMdPath: string;
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
  copiedConfigPath: string;
  fetchedRepos: string[];
  alreadyPresentRepos: string[];
}

export async function runApply(cwd = process.cwd()): Promise<ApplyResult> {
  const completed: ApplyStage[] = [];
  let stage: ApplyStage = "prepare";
  const report = (nextStage: ApplyStage, done: boolean) => {
    stage = nextStage;
    if (done) completed.push(nextStage);
  };
  try {
    const loaded = await loadConfig(cwd);
    const runtimePaths = await getRuntimePaths(loaded.config);
    const runtimeConfig = {
      ...loaded.config,
      ghqRoot: runtimePaths.resolvedGhqRoot,
      workspaceRoot: runtimePaths.resolvedWorkspaceRoot,
    };
    report("prepare", true);
    report("repos", false);
    const ensuredRepos = await ensureRepos(runtimeConfig);
    report("repos", true);
    const syncResult = await runSync(cwd, runtimeConfig, report);
    report("config-copy", false);
    const copiedConfigPath = await copyConfigToWorkspace(
      loaded.path,
      runtimeConfig,
    );
    report("config-copy", true);
    return {
      ...syncResult,
      copiedConfigPath,
      fetchedRepos: ensuredRepos.fetched,
      alreadyPresentRepos: ensuredRepos.alreadyPresent,
    };
  } catch (cause) {
    throw new ApplyError(
      {
        completed,
        failedStage: stage,
        failedStageMayHaveChanges: stage !== "prepare",
      },
      cause,
    );
  }
}
