import { access, lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { getRuntimePaths } from "../config/machine-paths.js";
import type { GhqWsConfig } from "../config/schema.js";
import { hasGh, listGhOwnerCandidates } from "../shared/gh.js";
import { getGhqRoot, hasGhq } from "../shared/ghq.js";
import { info, success, warn } from "../shared/logger.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";
import {
  getEnabledAgentSkillProviders,
  planAgentSkills,
} from "../workspace/agent-skills.js";

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

  const runtimePaths = await getRuntimePaths(config, {
    detectedGhqRoot,
  });
  if (runtimePaths.configuredGhqRoot !== runtimePaths.resolvedGhqRoot) {
    push(
      "warn",
      "config ghqRoot",
      `configured ${runtimePaths.configuredGhqRoot}, runtime ${runtimePaths.resolvedGhqRoot}`,
    );
  } else {
    push("info", "config ghqRoot", `runtime ${runtimePaths.resolvedGhqRoot}`);
  }
  if (runtimePaths.resolvedGhqRoot !== detectedGhqRoot) {
    push(
      "warn",
      "runtime ghqRoot",
      `differs from detected ghq root (${runtimePaths.resolvedGhqRoot} vs ${detectedGhqRoot})`,
    );
  }

  const workspaceRoot = runtimePaths.resolvedWorkspaceRoot;
  if (runtimePaths.configuredWorkspaceRoot !== workspaceRoot) {
    push(
      "info",
      "config workspaceRoot",
      `configured ${runtimePaths.configuredWorkspaceRoot}, runtime ${workspaceRoot}`,
    );
  } else {
    push("info", "config workspaceRoot", `runtime ${workspaceRoot}`);
  }

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
    const source = getRepoSourcePath(runtimePaths.resolvedGhqRoot, repo);

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

  const runtimeConfig = {
    ...config,
    ghqRoot: runtimePaths.resolvedGhqRoot,
    workspaceRoot,
  };
  const enabledAgentSkillProviders =
    getEnabledAgentSkillProviders(runtimeConfig);
  const agentSkillsPlan = await planAgentSkills(runtimeConfig);
  if (enabledAgentSkillProviders.length === 0) {
    push("info", "agent skills", "disabled by config");
  } else {
    push(
      "info",
      "agent skills",
      `discovered ${agentSkillsPlan.summary.discoveredCount}, linked ${agentSkillsPlan.summary.selectedCount}, duplicates ${agentSkillsPlan.summary.duplicateCount}, warnings ${agentSkillsPlan.summary.warningCount}`,
    );
    for (const provider of enabledAgentSkillProviders) {
      const providerSummary = agentSkillsPlan.summary.byProvider[provider];
      push(
        "info",
        `agent skills .${provider}`,
        `discovered ${providerSummary.discoveredCount}, linked ${providerSummary.selectedCount}, duplicates ${providerSummary.duplicateCount}, warnings ${providerSummary.warningCount}`,
      );
    }
    for (const group of agentSkillsPlan.duplicateGroups) {
      push(
        "warn",
        `agent skill duplicate .${group.provider}`,
        `${group.key}: selected ${group.selected.repo.label}, skipped ${group.skipped.map((entry) => entry.repo.label).join(", ")}`,
      );
    }
    for (const warningEntry of agentSkillsPlan.warnings) {
      push(
        warningEntry.type === "frontmatter-parse" ? "warn" : "info",
        `agent skill warning .${warningEntry.provider}`,
        `${warningEntry.repo}/${warningEntry.skillDirectoryName}: ${warningEntry.message}`,
      );
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
    } else {
      push("info", "code workspace", "disabled by config");
    }

    for (const repo of config.repos) {
      const label = `${repo.provider}/${repo.owner}/${repo.name}`;
      const destination = getRepoDestinationPath(workspaceRoot, repo);

      try {
        const stats = await lstat(destination);
        if (!stats.isSymbolicLink()) {
          push("warn", `link ${label}`, `not a symlink (${destination})`);
          continue;
        }

        const target = await readlink(destination);
        push("success", `link ${label}`, `ok (${destination} -> ${target})`);
      } catch {
        push("warn", `link ${label}`, `missing (${destination})`);
      }
    }

    if (enabledAgentSkillProviders.length > 0) {
      for (const skill of agentSkillsPlan.selected) {
        try {
          const stats = await lstat(skill.destinationPath);
          if (!stats.isSymbolicLink()) {
            push(
              "warn",
              `agent skill link .${skill.provider}`,
              `not a symlink (${skill.destinationPath})`,
            );
            continue;
          }

          const target = await readlink(skill.destinationPath);
          push(
            "success",
            `agent skill link .${skill.provider}`,
            `ok (${skill.destinationPath} -> ${target})`,
          );
        } catch {
          push(
            "warn",
            `agent skill link .${skill.provider}`,
            `missing (${skill.destinationPath})`,
          );
        }
      }

      const reportPaths = [
        path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.json"),
        path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.md"),
      ];
      for (const reportPath of reportPaths) {
        try {
          await access(reportPath);
          push("success", "agent skills report", `ok (${reportPath})`);
        } catch {
          push("warn", "agent skills report", `missing (${reportPath})`);
        }
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
    ghqRoot: runtimePaths.resolvedGhqRoot,
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
  ownerCandidateCount: number,
  push: (level: DoctorCheck["level"], scope: string, message: string) => void,
) {
  const provider = config.defaults?.provider ?? null;
  const owner = config.defaults?.owner ?? null;
  const category = config.defaults?.category ?? null;

  if (!provider) {
    push("info", "defaults.provider", "unset (will use github.com)");
  } else {
    push("success", "defaults.provider", `ok (${provider})`);
  }

  if (!owner) {
    if (ownerCandidateCount === 0) {
      push("warn", "defaults.owner", "unset and no gh account available");
    } else if (activeCandidate) {
      push(
        "info",
        "defaults.owner",
        `unset (short clone will use active gh account ${activeCandidate})`,
      );
    } else {
      push("info", "defaults.owner", "unset (short clone will prompt)");
    }
  } else {
    push("success", "defaults.owner", `ok (${owner})`);
  }

  if (!category) {
    push(
      "info",
      "defaults.category",
      "unset (clone will prompt or require --category)",
    );
  } else if (!config.categories.includes(category)) {
    push("warn", "defaults.category", `not listed in categories (${category})`);
  } else {
    push("success", "defaults.category", `ok (${category})`);
  }
}

function checkCategories(
  config: GhqWsConfig,
  push: (level: DoctorCheck["level"], scope: string, message: string) => void,
) {
  if (config.categories.length === 0) {
    push("warn", "categories", "empty");
    return;
  }

  const duplicates = findDuplicates(config.categories);
  if (duplicates.length > 0) {
    push("warn", "categories", `duplicate values: ${duplicates.join(", ")}`);
    return;
  }

  push("success", "categories", `ok (${config.categories.join(", ")})`);
}

function findDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}
