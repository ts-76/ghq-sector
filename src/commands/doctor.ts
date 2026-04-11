import { access, lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import type { GhqWsConfig } from "../config/schema.js";
import { hasGh, listGhOwnerCandidates } from "../shared/gh.js";
import { getGhqRoot, hasGhq } from "../shared/ghq.js";
import { info, success, warn } from "../shared/logger.js";
import { expandHome } from "../shared/paths.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";

export interface DoctorCheck {
  level: "success" | "info" | "warn";
  scope: string;
  message: string;
}

export interface DoctorResult {
  ok: boolean;
  configPath: string;
  checks: DoctorCheck[];
  summary: {
    successCount: number;
    infoCount: number;
    warnCount: number;
  };
  ghqRoot: string;
  workspaceRoot: string;
  defaults: {
    provider: string | null;
    owner: string | null;
    category: string | null;
  };
  accounts: {
    login: string;
    active: boolean;
  }[];
}

export async function runDoctor(cwd = process.cwd()): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  const push = (
    level: DoctorCheck["level"],
    scope: string,
    message: string,
  ) => {
    checks.push({ level, scope, message });
    const text = `${scope}: ${message}`;
    if (level === "success") {
      success(text);
      return;
    }
    if (level === "warn") {
      warn(text);
      return;
    }
    info(text);
  };

  const ghqAvailable = await hasGhq();
  if (!ghqAvailable) {
    throw new Error("ghq command is not available");
  }

  const ghAvailable = await hasGh();
  if (!ghAvailable) {
    throw new Error("gh command is not available");
  }

  const detectedGhqRoot = await getGhqRoot();
  push("success", "ghq", `ok (${detectedGhqRoot})`);

  const ownerCandidates = await listGhOwnerCandidates();
  push(
    "success",
    "gh",
    `ok (${ownerCandidates.length} github.com account${ownerCandidates.length === 1 ? "" : "s"})`,
  );
  if (ownerCandidates.length > 0) {
    push(
      "info",
      "gh accounts",
      ownerCandidates
        .map(
          (candidate) =>
            `${candidate.login}${candidate.active ? " (active)" : ""}`,
        )
        .join(", "),
    );
  }

  const activeCandidate =
    ownerCandidates.find((candidate) => candidate.active)?.login ?? null;
  const { path: configPath, config } = await loadConfig(cwd);
  push("success", "config", `ok (${configPath})`);

  const expandedConfigGhqRoot = expandHome(config.ghqRoot);
  if (expandedConfigGhqRoot !== detectedGhqRoot) {
    push(
      "warn",
      "config ghqRoot",
      `differs from detected ghq root (${config.ghqRoot})`,
    );
  }

  const workspaceRoot = expandHome(config.workspaceRoot);
  let workspaceRootExists = true;
  try {
    await access(workspaceRoot);
    push("success", "workspace root", `ok (${workspaceRoot})`);
  } catch {
    workspaceRootExists = false;
    push("info", "workspace root", `not created yet (${workspaceRoot})`);
  }

  checkDefaults(config, activeCandidate, ownerCandidates.length, push);
  checkCategories(config, push);

  for (const resource of config.resources ?? []) {
    const source = path.resolve(path.dirname(configPath), resource.from);

    try {
      await access(source);
      push("info", "resource source", `ok (${source})`);
    } catch {
      push("warn", "resource source", `missing (${source})`);
    }
  }

  for (const repo of config.repos) {
    const label = `${repo.provider}/${repo.owner}/${repo.name}`;
    const source = getRepoSourcePath(detectedGhqRoot, repo);

    if (!config.categories.includes(repo.category)) {
      push(
        "warn",
        `repo ${label}`,
        `category ${repo.category} is not declared in categories`,
      );
    }

    try {
      await access(source);
      push("info", `repo ${label}`, `source ok (${source})`);
    } catch {
      push("warn", `repo ${label}`, `missing source (${source})`);
    }
  }

  if (!workspaceRootExists) {
    push(
      "info",
      "workspace checks",
      "skipped because workspace root does not exist yet",
    );
  } else {
    for (const resource of config.resources ?? []) {
      const destination = path.join(workspaceRoot, resource.to);

      try {
        await access(destination);
        push("info", "resource target", `ok (${destination})`);
      } catch {
        push("warn", "resource target", `missing (${destination})`);
      }
    }

    const codeWorkspaceEnabled = config.editor?.codeWorkspace?.enabled ?? true;
    if (codeWorkspaceEnabled) {
      const filename =
        config.editor?.codeWorkspace?.filename ??
        `${path.basename(workspaceRoot)}.code-workspace`;
      const codeWorkspacePath = path.join(workspaceRoot, filename);

      try {
        await access(codeWorkspacePath);
        push("success", "code workspace", `ok (${codeWorkspacePath})`);
      } catch {
        push("warn", "code workspace", `missing (${codeWorkspacePath})`);
      }
    }

    for (const repo of config.repos) {
      const label = `${repo.provider}/${repo.owner}/${repo.name}`;
      const dest = getRepoDestinationPath(workspaceRoot, repo);

      try {
        const stat = await lstat(dest);
        if (!stat.isSymbolicLink()) {
          push(
            "warn",
            `repo ${label}`,
            `destination is not a symlink (${dest})`,
          );
          continue;
        }

        const target = await readlink(dest);
        push("info", `repo ${label}`, `link ok (${dest} -> ${target})`);
      } catch {
        push("warn", `repo ${label}`, `missing link (${dest})`);
      }
    }
  }

  const summary = {
    successCount: checks.filter((check) => check.level === "success").length,
    infoCount: checks.filter((check) => check.level === "info").length,
    warnCount: checks.filter((check) => check.level === "warn").length,
  };

  return {
    ok: summary.warnCount === 0,
    configPath,
    checks,
    summary,
    ghqRoot: detectedGhqRoot,
    workspaceRoot,
    defaults: {
      provider: config.defaults?.provider ?? null,
      owner: config.defaults?.owner ?? null,
      category: config.defaults?.category ?? null,
    },
    accounts: ownerCandidates,
  };
}

function checkDefaults(
  config: GhqWsConfig,
  activeCandidate: string | null,
  candidateCount: number,
  push: (level: DoctorCheck["level"], scope: string, message: string) => void,
) {
  if (config.defaults?.provider) {
    push("success", "defaults.provider", config.defaults.provider);
  } else {
    push("warn", "defaults.provider", "missing");
  }

  if (config.defaults?.category) {
    push("success", "defaults.category", config.defaults.category);
  } else {
    push("warn", "defaults.category", "missing");
  }

  if (config.defaults?.owner) {
    const ownerLabel =
      config.defaults.owner === activeCandidate ? " (active)" : "";
    push("success", "defaults.owner", `${config.defaults.owner}${ownerLabel}`);
    push("success", "shorthand clone", "available");
    return;
  }

  push("warn", "defaults.owner", "missing");
  if (candidateCount > 0) {
    push(
      "warn",
      "shorthand clone",
      "interactive owner selection available, or use --owner",
    );
    return;
  }

  push("warn", "shorthand clone", "requires --owner or full repository path");
}

function checkCategories(
  config: GhqWsConfig,
  push: (level: DoctorCheck["level"], scope: string, message: string) => void,
) {
  const seen = new Set<string>();
  for (const category of config.categories) {
    if (seen.has(category)) {
      push("warn", "categories", `duplicate category (${category})`);
      continue;
    }
    seen.add(category);
  }

  if (
    config.defaults?.category &&
    !config.categories.includes(config.defaults.category)
  ) {
    push(
      "warn",
      "defaults.category",
      `not declared in categories (${config.defaults.category})`,
    );
  }
}
