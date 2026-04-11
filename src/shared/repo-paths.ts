import path from "node:path";
import type { GhqWsRepoConfig } from "../config/schema.js";

export function getRepoSourcePath(ghqRoot: string, repo: GhqWsRepoConfig) {
  return path.join(ghqRoot, repo.provider, repo.owner, repo.name);
}

export function getRepoDestinationPath(
  workspaceRoot: string,
  repo: GhqWsRepoConfig,
) {
  return path.join(workspaceRoot, repo.category, repo.name);
}
