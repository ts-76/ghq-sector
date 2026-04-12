import { access } from "node:fs/promises";
import path from "node:path";
import { resolveConfigForCurrentMachine } from "../config/machine-paths.js";
import { saveConfig } from "../config/save-config.js";
import type { GhqWsConfig, GhqWsRepoConfig } from "../config/schema.js";
import { ghqGet } from "../ghq/ghq-get.js";
import { runHooks } from "../hooks/run-hooks.js";
import { copyResources } from "../resources/copy-resources.js";
import { resolveOwner } from "../shared/gh.js";
import { info } from "../shared/logger.js";
import { selectFromChoices } from "../shared/prompt.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";
import { generateCodeWorkspace } from "../workspace/generate-code-workspace.js";
import { syncWorkspace } from "../workspace/sync-workspace.js";

export interface CloneOptions {
  repository: string;
  category?: string;
  owner?: string;
  provider?: string;
  configPath: string;
  yes?: boolean;
}

export interface CloneResult {
  config: GhqWsConfig;
  repo: GhqWsRepoConfig;
  repositoryPath: string;
  sourcePath: string;
  destinationPath: string;
  linkedCount: number;
  copiedResourcesCount: number;
  codeWorkspacePath: string | null;
}

export async function runClone(
  config: GhqWsConfig,
  options: CloneOptions,
): Promise<CloneResult> {
  const runtimeConfig = await resolveConfigForCurrentMachine(config);
  const repo = await parseRepository(
    options.repository,
    options,
    runtimeConfig,
  );
  const ghqRoot = runtimeConfig.ghqRoot;
  const workspaceRoot = runtimeConfig.workspaceRoot;
  const sourcePath = getRepoSourcePath(ghqRoot, repo);
  const destinationPath = getRepoDestinationPath(workspaceRoot, repo);
  const repositoryPath = `${repo.provider}/${repo.owner}/${repo.name}`;

  await runHooks(runtimeConfig.hooks?.beforeClone, {
    provider: repo.provider,
    owner: repo.owner,
    repo: repo.name,
    category: repo.category,
    ghqPath: sourcePath,
    workspacePath: destinationPath,
    ghqRoot,
    workspaceRoot,
  });

  await ghqGet(repositoryPath);
  await access(sourcePath);

  await runHooks(runtimeConfig.hooks?.afterClone, {
    provider: repo.provider,
    owner: repo.owner,
    repo: repo.name,
    category: repo.category,
    ghqPath: sourcePath,
    workspacePath: destinationPath,
    ghqRoot,
    workspaceRoot,
  });

  const nextConfig: GhqWsConfig = {
    ...runtimeConfig,
    repos: upsertRepo(runtimeConfig.repos, repo),
  };

  await saveConfig(options.configPath, nextConfig);
  const syncResult = await syncWorkspace(nextConfig);
  const copiedResources = await copyResources(
    nextConfig,
    path.dirname(options.configPath),
  );
  const codeWorkspacePath = await generateCodeWorkspace(nextConfig);

  info(`cloned repository: ${repositoryPath}`);
  info(`linked repos: ${syncResult.linked.length}`);
  if (codeWorkspacePath) {
    info(`generated code workspace: ${codeWorkspacePath}`);
  }

  return {
    config: nextConfig,
    repo,
    repositoryPath,
    sourcePath,
    destinationPath,
    linkedCount: syncResult.linked.length,
    copiedResourcesCount: copiedResources.length,
    codeWorkspacePath: codeWorkspacePath ?? null,
  };
}

async function parseRepository(
  repository: string,
  options: CloneOptions,
  config: GhqWsConfig,
): Promise<GhqWsRepoConfig> {
  const parts = repository.split("/");
  const provider =
    options.provider ?? config.defaults?.provider ?? "github.com";
  const owner = await resolveCloneOwner(parts, options, config);
  const defaultCategory = config.defaults?.category;
  const category = resolveCategory(options.category, defaultCategory);

  if (parts.length === 3) {
    return {
      provider: parts[0],
      owner: parts[1],
      name: parts[2],
      category,
    };
  }

  if (parts.length === 2) {
    return {
      provider,
      owner: parts[0],
      name: parts[1],
      category,
    };
  }

  if (parts.length === 1 && owner) {
    return {
      provider,
      owner,
      name: parts[0],
      category,
    };
  }

  throw new Error(
    "repository must be provider/owner/name, owner/name, or name with defaults.owner, --owner, or gh account selection",
  );
}

async function resolveCloneOwner(
  repositoryParts: string[],
  options: CloneOptions,
  config: GhqWsConfig,
) {
  if (repositoryParts.length >= 2) {
    return options.owner ?? config.defaults?.owner;
  }

  const resolved = await resolveOwner(
    options.owner,
    config.defaults?.owner,
    !options.yes,
  );
  if (typeof resolved === "string" || resolved === null) {
    return resolved;
  }

  info("select owner for shorthand clone:");
  const selection = await selectFromChoices(
    "owner choice",
    [
      ...resolved.candidates.map(
        (candidate) =>
          `${candidate.login}${candidate.active ? " (active)" : ""}`,
      ),
      "cancel",
    ],
    resolved.defaultIndex,
  );

  if (!selection || selection.index >= resolved.candidates.length) {
    return null;
  }

  return resolved.candidates[selection.index].login;
}

function resolveCategory(
  category: string | undefined,
  defaultCategory: string | undefined,
) {
  if (category) {
    return category;
  }

  if (defaultCategory) {
    return defaultCategory;
  }

  throw new Error(
    "category is required (pass --category or set defaults.category in config)",
  );
}

function upsertRepo(repos: GhqWsRepoConfig[], repo: GhqWsRepoConfig) {
  const next = repos.filter(
    (current) =>
      !(
        current.provider === repo.provider &&
        current.owner === repo.owner &&
        current.name === repo.name
      ),
  );
  next.push(repo);
  return next;
}
