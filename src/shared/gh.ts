import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhOwnerCandidate {
  login: string;
  active: boolean;
}

export interface GhRepositoryCandidate {
  provider: string;
  owner: string;
  name: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
}

export async function listGhOwnerCandidates(): Promise<GhOwnerCandidate[]> {
  const { stdout } = await execFileAsync("gh", ["auth", "status"]);
  const candidates: GhOwnerCandidate[] = [];
  let currentHost = "";

  for (const line of stdout.split("\n")) {
    const hostMatch = line.match(/^([\w.-]+\.com)$/);
    if (hostMatch) {
      currentHost = hostMatch[1];
      continue;
    }

    if (currentHost !== "github.com") {
      continue;
    }

    const loginMatch = line.match(
      /Logged in to github\.com account\s+([^\s]+)\s+\(/,
    );
    if (loginMatch) {
      candidates.push({
        login: loginMatch[1],
        active: false,
      });
      continue;
    }

    if (candidates.length > 0 && line.includes("Active account: true")) {
      candidates[candidates.length - 1].active = true;
    }
  }

  return candidates;
}

export async function listGhRepositories(
  owner: string,
  limit = 100,
): Promise<GhRepositoryCandidate[]> {
  const { stdout } = await execFileAsync("gh", [
    "repo",
    "list",
    owner,
    "--limit",
    String(limit),
    "--json",
    "name,nameWithOwner,isPrivate,url,owner",
  ]);

  const payload = JSON.parse(stdout) as {
    name: string;
    nameWithOwner: string;
    isPrivate: boolean;
    url: string;
    owner?: { login?: string };
  }[];

  return payload.map((repo) => ({
    provider: "github.com",
    owner: repo.owner?.login ?? owner,
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    url: repo.url,
    isPrivate: repo.isPrivate,
  }));
}

export async function resolveOwner(
  explicitOwner: string | undefined,
  defaultOwner: string | undefined,
  interactive: boolean,
) {
  if (explicitOwner) {
    return explicitOwner;
  }

  if (defaultOwner) {
    return defaultOwner;
  }

  const candidates = await listGhOwnerCandidates();
  if (candidates.length === 0) {
    return null;
  }

  if (!interactive) {
    return (
      candidates.find((candidate) => candidate.active)?.login ??
      candidates[0]?.login ??
      null
    );
  }

  return {
    candidates,
    defaultIndex: Math.max(
      0,
      candidates.findIndex((candidate) => candidate.active),
    ),
  };
}

export async function hasGh() {
  try {
    await listGhOwnerCandidates();
    return true;
  } catch {
    return false;
  }
}
