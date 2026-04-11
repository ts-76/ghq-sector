import { access } from "node:fs/promises";
import type { GhqWsConfig, GhqWsRepoConfig } from "../config/schema.js";
import { runHooks } from "../hooks/run-hooks.js";
import { expandHome } from "../shared/paths.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";
import { ghqGet } from "./ghq-get.js";

export interface EnsureReposResult {
  fetched: string[];
  alreadyPresent: string[];
}

export async function ensureRepos(
  config: GhqWsConfig,
): Promise<EnsureReposResult> {
  const ghqRoot = expandHome(config.ghqRoot);
  const workspaceRoot = expandHome(config.workspaceRoot);
  const fetched: string[] = [];
  const alreadyPresent: string[] = [];

  for (const repo of config.repos) {
    const repositoryPath = formatRepositoryPath(repo);
    const ghqPath = getRepoSourcePath(ghqRoot, repo);
    const workspacePath = getRepoDestinationPath(workspaceRoot, repo);

    try {
      await access(ghqPath);
      alreadyPresent.push(repositoryPath);
    } catch {
      await runHooks(config.hooks?.beforeClone, {
        provider: repo.provider,
        owner: repo.owner,
        repo: repo.name,
        category: repo.category,
        ghqPath,
        workspacePath,
        ghqRoot,
        workspaceRoot,
      });

      await ghqGet(repositoryPath);
      await access(ghqPath);

      await runHooks(config.hooks?.afterClone, {
        provider: repo.provider,
        owner: repo.owner,
        repo: repo.name,
        category: repo.category,
        ghqPath,
        workspacePath,
        ghqRoot,
        workspaceRoot,
      });

      fetched.push(repositoryPath);
    }
  }

  return { fetched, alreadyPresent };
}

function formatRepositoryPath(repo: GhqWsRepoConfig) {
  return `${repo.provider}/${repo.owner}/${repo.name}`;
}
