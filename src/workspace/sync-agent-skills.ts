import { unlink } from "node:fs/promises";
import path from "node:path";
import { warn } from "../shared/logger.js";
import type {
  AgentSkillProvider,
  DiscoveredAgentSkill,
  PlannedAgentSkills,
} from "./agent-skills.js";
import {
  assertDirectory,
  assertDistinctLinks,
  assertLink,
  assertLinkDirectories,
  assertMetadataFile,
  assertSafePath,
  installLink,
  readLinkManifest,
  removeRecordedLink,
  statIfPresent,
  usesCaseInsensitivePaths,
  writeLinkManifest,
  writeMetadataFile,
} from "./safe-links.js";

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

export async function prepareAgentSkillsSync(
  workspaceRoot: string,
  plan: PlannedAgentSkills,
) {
  const reports = {
    json: path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.json"),
    markdown: path.join(workspaceRoot, ".ghq-sector", "agent-skills-report.md"),
  };
  const manifestPath = path.join(
    workspaceRoot,
    ".ghq-sector",
    "agent-skills-manifest.json",
  );
  await assertDirectory(workspaceRoot, workspaceRoot);
  for (const filename of [manifestPath, reports.json, reports.markdown]) {
    await assertMetadataFile(workspaceRoot, filename);
  }
  const previous = await readLinkManifest(manifestPath);
  const links = plan.enabled ? plan.selected : [];
  const caseInsensitive = await usesCaseInsensitivePaths(workspaceRoot);
  assertDistinctLinks(links, caseInsensitive);
  assertLinkDirectories(
    links,
    [
      path.dirname(manifestPath),
      ...links.map((link) => path.dirname(link.destinationPath)),
    ],
    caseInsensitive,
  );
  for (const skill of links) await assertLink(workspaceRoot, skill, previous);
  const desired = new Set(
    links.map((link) => path.resolve(link.destinationPath)),
  );
  const stale = plan.enabled
    ? previous.filter(
        (link) =>
          !desired.has(path.resolve(link.destinationPath)) &&
          isManagedSkillPath(workspaceRoot, link.destinationPath),
      )
    : [];
  // Validate stale parents before changing any current link. A manifest never
  // authorizes traversal through a symlink parent, or deletion of a real entry.
  for (const link of stale)
    await assertSafePath(workspaceRoot, link.destinationPath);
  return { reports, manifestPath, previous, stale };
}

export async function syncAgentSkills(
  workspaceRoot: string,
  plan: PlannedAgentSkills,
  prepared?: Awaited<ReturnType<typeof prepareAgentSkillsSync>>,
): Promise<SyncAgentSkillsResult> {
  const { reports, manifestPath, previous, stale } =
    prepared ?? (await prepareAgentSkillsSync(workspaceRoot, plan));
  if (!plan.enabled) {
    for (const filename of [reports.json, reports.markdown]) {
      await assertMetadataFile(workspaceRoot, filename);
      if (await statIfPresent(filename)) await unlink(filename);
    }
    return {
      linked: [],
      removed: [],
      reports,
      summary: {
        linkedCount: 0,
        removedCount: 0,
        duplicateCount: 0,
        warningCount: 0,
        byProvider: { agents: { linkedCount: 0 }, claude: { linkedCount: 0 } },
      },
    };
  }
  const removed: string[] = [];
  for (const link of stale) {
    if (await removeRecordedLink(workspaceRoot, link))
      removed.push(link.destinationPath);
    else if (await statIfPresent(link.destinationPath))
      warn(
        `preserve stale skill: ${link.destinationPath} (not a matching recorded symlink)`,
      );
  }
  const linked: string[] = [];
  for (const skill of plan.selected) {
    await installLink(workspaceRoot, skill, previous);
    linked.push(skill.destinationPath);
  }

  await writeLinkManifest(workspaceRoot, manifestPath, plan.selected);

  await writeMetadataFile(
    workspaceRoot,
    reports.json,
    `${JSON.stringify(toJsonReport(workspaceRoot, plan), null, 2)}\n`,
  );
  await writeMetadataFile(
    workspaceRoot,
    reports.markdown,
    toMarkdownReport(workspaceRoot, plan),
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

function isManagedSkillPath(workspaceRoot: string, entryPath: string): boolean {
  const relative = path.relative(
    path.resolve(workspaceRoot),
    path.resolve(entryPath),
  );
  return [".agents", ".claude"].some((provider) => {
    const prefix = `${provider}${path.sep}skills${path.sep}`;
    return (
      relative.startsWith(prefix) &&
      relative.slice(prefix.length).split(path.sep).length === 1 &&
      relative.slice(prefix.length) !== ""
    );
  });
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
    ...plan.providers.map(
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
