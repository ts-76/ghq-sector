import { loadConfig } from '../config/load-config.js';
import { copyConfigToWorkspace } from '../config/copy-config-to-workspace.js';
import { ensureRepos } from '../ghq/ensure-repos.js';
import { runSync } from './sync.js';

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
  const ensuredRepos = await ensureRepos(loaded.config);
  const syncResult = await runSync(cwd);
  const copiedConfigPath = await copyConfigToWorkspace(loaded.path, loaded.config);

  return {
    ...syncResult,
    copiedConfigPath,
    fetchedRepos: ensuredRepos.fetched,
    alreadyPresentRepos: ensuredRepos.alreadyPresent,
  };
}
