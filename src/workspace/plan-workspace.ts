import { access } from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths } from "../config/machine-paths.js";
import type { GhqWsConfig } from "../config/schema.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";

export interface PlannedRepoLink {
  provider: string;
  owner: string;
  name: string;
  category: string;
  ghqPath: string;
  workspacePath: string;
  available: boolean;
  status: "ready" | "fetch";
}

export interface PlannedResourceCopy {
  from: string;
  to: string;
  mode?: string;
}

export interface CodeWorkspacePlan {
  enabled: boolean;
  path: string | null;
  folders: { path: string }[];
  settings: Record<string, unknown>;
}

export interface WorkspacePlan {
  ghqRoot: string;
  workspaceRoot: string;
  repoLinks: PlannedRepoLink[];
  resources: PlannedResourceCopy[];
  codeWorkspace: CodeWorkspacePlan;
  summary: {
    totalRepos: number;
    linkableRepos: number;
    missingRepos: number;
    resourcesCount: number;
  };
}

export function buildCodeWorkspacePlan(config: GhqWsConfig): CodeWorkspacePlan {
  const workspaceRoot = config.workspaceRoot;
  const enabled = config.editor?.codeWorkspace?.enabled ?? true;
  const filename =
    config.editor?.codeWorkspace?.filename ??
    `${path.basename(workspaceRoot)}.code-workspace`;
  const folders = [...config.repos]
    .sort((left, right) => {
      const categoryCompare = left.category.localeCompare(right.category);
      return categoryCompare !== 0
        ? categoryCompare
        : left.name.localeCompare(right.name);
    })
    .map((repo) => ({
      path: `${repo.category}/${repo.name}`,
    }));

  return {
    enabled,
    path: enabled ? path.join(workspaceRoot, filename) : null,
    folders,
    settings: {
      "files.exclude": {
        "**/.git": true,
        "**/.DS_Store": true,
      },
    },
  };
}

export async function planWorkspace(
  config: GhqWsConfig,
  cwd = process.cwd(),
): Promise<WorkspacePlan> {
  const runtimePaths = await getRuntimePaths(config);
  const workspaceRoot = runtimePaths.resolvedWorkspaceRoot;
  const ghqRoot = runtimePaths.resolvedGhqRoot;
  const runtimeConfig = {
    ...config,
    ghqRoot,
    workspaceRoot,
  };

  const repoLinks = await Promise.all(
    [...runtimeConfig.repos]
      .sort((left, right) => {
        const categoryCompare = left.category.localeCompare(right.category);
        if (categoryCompare !== 0) return categoryCompare;
        const ownerCompare = left.owner.localeCompare(right.owner);
        return ownerCompare !== 0
          ? ownerCompare
          : left.name.localeCompare(right.name);
      })
      .map(async (repo) => {
        const ghqPath = getRepoSourcePath(ghqRoot, repo);
        const workspacePath = getRepoDestinationPath(workspaceRoot, repo);
        let available = true;

        try {
          await access(ghqPath);
        } catch {
          available = false;
        }

        return {
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          category: repo.category,
          ghqPath,
          workspacePath,
          available,
          status: available ? "ready" : "fetch",
        } satisfies PlannedRepoLink;
      }),
  );

  const resources = (runtimeConfig.resources ?? []).map(
    (resource) =>
      ({
        from: path.resolve(cwd, resource.from),
        to: path.resolve(workspaceRoot, resource.to),
        mode: resource.mode,
      }) satisfies PlannedResourceCopy,
  );

  const linkableRepos = repoLinks.filter((repo) => repo.available).length;
  const missingRepos = repoLinks.length - linkableRepos;

  return {
    ghqRoot,
    workspaceRoot,
    repoLinks,
    resources,
    codeWorkspace: buildCodeWorkspacePlan(runtimeConfig),
    summary: {
      totalRepos: repoLinks.length,
      linkableRepos,
      missingRepos,
      resourcesCount: resources.length,
    },
  };
}
