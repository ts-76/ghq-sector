import { access, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import type { GhqWsConfig } from "../config/schema.js";
import { runHooks } from "../hooks/run-hooks.js";
import { warn } from "../shared/logger.js";
import { expandHome } from "../shared/paths.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";

export interface SyncWorkspaceResult {
  workspaceRoot: string;
  linked: string[];
  skipped: string[];
}

export async function syncWorkspace(
  config: GhqWsConfig,
): Promise<SyncWorkspaceResult> {
  const workspaceRoot = expandHome(config.workspaceRoot);
  const ghqRoot = expandHome(config.ghqRoot);
  const linked: string[] = [];
  const skipped: string[] = [];

  await mkdir(workspaceRoot, { recursive: true });

  for (const category of config.categories) {
    await mkdir(path.join(workspaceRoot, category), { recursive: true });
  }

  for (const repo of config.repos) {
    const sourcePath = getRepoSourcePath(ghqRoot, repo);
    const destinationPath = getRepoDestinationPath(workspaceRoot, repo);

    try {
      await access(sourcePath);
    } catch {
      warn(`skip missing source: ${sourcePath}`);
      skipped.push(sourcePath);
      continue;
    }

    await rm(destinationPath, { recursive: true, force: true });
    await symlink(sourcePath, destinationPath);
    linked.push(destinationPath);

    await runHooks(config.hooks?.afterLink, {
      provider: repo.provider,
      owner: repo.owner,
      repo: repo.name,
      category: repo.category,
      ghqPath: sourcePath,
      workspacePath: destinationPath,
      ghqRoot,
      workspaceRoot,
    });
  }

  await runHooks(config.hooks?.afterSync, {
    ghqRoot,
    workspaceRoot,
    linkedCount: linked.length,
  });

  return { workspaceRoot, linked, skipped };
}
