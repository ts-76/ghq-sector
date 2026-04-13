import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentSkillProvider,
  DiscoveredAgentSkill,
  PlannedAgentSkills,
} from "./agent-skills.js";

export interface SyncAgentSkillsResult {
  linked: string[];
  removed: string[];
  reports: {
    json: string;
    markdown: string;
  };
  summary: {
    linkedCount: number;
    removedCount: number;
    duplicateCount: number;
    warningCount: number;
    byProvider: Record<AgentSkillProvider, { linkedCount: number }>;
  };
}

export async function syncAgentSkills(
  workspaceRoot: string,
  plan: PlannedAgentSkills,
): Promise<SyncAgentSkillsResult> {
  const reports = {
    json: path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.json"),
    markdown: path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.md"),
  };

  if (!plan.enabled) {
    await rm(
      path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.json"),
      {
        force: true,
      },
    );
    await rm(
      path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.md"),
      {
        force: true,
      },
    );
    return {
      linked: [],
      removed: [],
      reports,
      summary: {
        linkedCount: 0,
        removedCount: 0,
        duplicateCount: 0,
        warningCount: 0,
        byProvider: {
          agents: { linkedCount: 0 },
          claude: { linkedCount: 0 },
        },
      },
    };
  }

  const desired = new Set(plan.selected.map((skill) => skill.destinationPath));
  const manifestPath = path.join(
    workspaceRoot,
    ".ghq-sector",
    "agent-skills-manifest.json",
  );
  const previous = await readPreviousManifest(manifestPath);
  const removed: string[] = [];

  for (const previousPath of previous) {
    if (!desired.has(previousPath)) {
      await rm(previousPath, { force: true, recursive: true });
      removed.push(previousPath);
    }
  }

  const linked: string[] = [];
  for (const skill of plan.selected) {
    await ensureParentTree(skill.destinationPath);
    await rm(skill.destinationPath, { force: true, recursive: true });
    await symlink(skill.sourcePath, skill.destinationPath, "dir");
    linked.push(skill.destinationPath);
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeManifest(manifestPath, linked);

  await mkdir(path.dirname(reports.json), { recursive: true });
  await writeFile(
    reports.json,
    `${JSON.stringify(toJsonReport(workspaceRoot, plan), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    reports.markdown,
    toMarkdownReport(workspaceRoot, plan),
    "utf8",
  );

  return {
    linked,
    removed,
    reports,
    summary: {
      linkedCount: linked.length,
      removedCount: removed.length,
      duplicateCount: plan.summary.duplicateCount,
      warningCount: plan.summary.warningCount,
      byProvider: {
        agents: {
          linkedCount: linked.filter((entry) =>
            entry.includes(`${path.sep}.agents${path.sep}`),
          ).length,
        },
        claude: {
          linkedCount: linked.filter((entry) =>
            entry.includes(`${path.sep}.claude${path.sep}`),
          ).length,
        },
      },
    },
  };
}

async function readPreviousManifest(manifestPath: string): Promise<string[]> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item: unknown) => typeof item === "string");
    }
    return [];
  } catch {
    return [];
  }
}

async function writeManifest(
  manifestPath: string,
  linked: string[],
): Promise<void> {
  await writeFile(manifestPath, `${JSON.stringify(linked, null, 2)}\n`, "utf8");
}

async function ensureParentTree(destinationPath: string) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
}

function toJsonReport(workspaceRoot: string, plan: PlannedAgentSkills) {
  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot,
    enabled: plan.enabled,
    providers: plan.providers,
    summary: plan.summary,
    selected: plan.selected.map(serializeSkill),
    duplicates: plan.duplicateGroups.map((group) => ({
      provider: group.provider,
      key: group.key,
      sameDescription: group.sameDescription,
      selected: serializeSkill(group.selected),
      skipped: group.skipped.map(serializeSkill),
    })),
    warnings: plan.warnings,
  };
}

function toMarkdownReport(workspaceRoot: string, plan: PlannedAgentSkills) {
  const lines = [
    "# Agent skills report",
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Workspace root: ${workspaceRoot}`,
    `- Providers: ${plan.providers.join(", ") || "none"}`,
    "",
    "## Summary",
    `- Discovered: ${plan.summary.discoveredCount}`,
    `- Linked: ${plan.summary.selectedCount}`,
    `- Duplicates skipped: ${plan.summary.duplicateCount}`,
    `- Warnings: ${plan.summary.warningCount}`,
    "",
    "## Per provider",
    ...(["agents", "claude"] as const).map(
      (provider) =>
        `- .${provider}: discovered ${plan.summary.byProvider[provider].discoveredCount}, linked ${plan.summary.byProvider[provider].selectedCount}, duplicates ${plan.summary.byProvider[provider].duplicateCount}, warnings ${plan.summary.byProvider[provider].warningCount}`,
    ),
    "",
    "## Selected skills",
  ];

  if (plan.selected.length === 0) {
    lines.push("- None");
  } else {
    for (const skill of plan.selected) {
      lines.push(
        `- .${skill.provider} ${skill.repo.label}/${skill.skillDirectoryName} -> ${skill.sourcePath}`,
      );
    }
  }

  lines.push("", "## Duplicates");

  if (plan.duplicateGroups.length === 0) {
    lines.push("- None");
  } else {
    for (const group of plan.duplicateGroups) {
      lines.push("", `### .${group.provider} / ${group.key}`);
      lines.push(
        `- Selected: ${group.selected.repo.label} -> ${group.selected.sourcePath}`,
      );
      for (const skipped of group.skipped) {
        lines.push(`- Skipped: ${skipped.repo.label} -> ${skipped.sourcePath}`);
      }
      if (!group.sameDescription) {
        lines.push("- Note: descriptions differ across duplicates");
      }
    }
  }

  lines.push("", "## Warnings");
  if (plan.warnings.length === 0) {
    lines.push("- None");
  } else {
    for (const warning of plan.warnings) {
      lines.push(
        `- [${warning.type}] .${warning.provider} ${warning.repo}/${warning.skillDirectoryName}: ${warning.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function serializeSkill(skill: DiscoveredAgentSkill) {
  return {
    provider: skill.provider,
    repo: skill.repo.label,
    skillDirectoryName: skill.skillDirectoryName,
    sourcePath: skill.sourcePath,
    skillMarkdownPath: skill.skillMarkdownPath,
    destinationPath: skill.destinationPath,
    frontmatter: skill.frontmatter,
  };
}
