import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { GhqWsConfig, GhqWsRepoConfig } from "../config/schema.js";
import { getRepoSourcePath } from "../shared/repo-paths.js";

export const AGENT_SKILL_PROVIDERS = ["agents", "claude"] as const;

export type AgentSkillProvider = (typeof AGENT_SKILL_PROVIDERS)[number];

export interface AgentSkillFrontmatter {
  name?: string;
  description?: string;
}

export interface AgentSkillWarning {
  type: "frontmatter-parse" | "missing-name";
  provider: AgentSkillProvider;
  repo: string;
  skillDirectoryName: string;
  skillPath: string;
  message: string;
}

export interface DiscoveredAgentSkill {
  provider: AgentSkillProvider;
  repo: {
    provider: string;
    owner: string;
    name: string;
    order: number;
    label: string;
  };
  skillDirectoryName: string;
  sourcePath: string;
  skillMarkdownPath: string;
  destinationPath: string;
  frontmatter: AgentSkillFrontmatter;
  normalizedName: string | null;
  normalizedDescription: string | null;
}

export interface AgentSkillDuplicateGroup {
  provider: AgentSkillProvider;
  key: string;
  selected: DiscoveredAgentSkill;
  skipped: DiscoveredAgentSkill[];
  sameDescription: boolean;
}

export interface PlannedAgentSkills {
  enabled: boolean;
  providers: AgentSkillProvider[];
  discovered: DiscoveredAgentSkill[];
  selected: DiscoveredAgentSkill[];
  duplicateGroups: AgentSkillDuplicateGroup[];
  warnings: AgentSkillWarning[];
  summary: {
    discoveredCount: number;
    selectedCount: number;
    duplicateCount: number;
    warningCount: number;
    byProvider: Record<
      AgentSkillProvider,
      {
        discoveredCount: number;
        selectedCount: number;
        duplicateCount: number;
        warningCount: number;
      }
    >;
  };
}

export function getEnabledAgentSkillProviders(
  config: GhqWsConfig,
): AgentSkillProvider[] {
  if (!config.agentSkills?.enabled) {
    return [];
  }

  const configured = config.agentSkills.providers ?? [...AGENT_SKILL_PROVIDERS];
  return AGENT_SKILL_PROVIDERS.filter((provider) =>
    configured.includes(provider),
  );
}

export async function planAgentSkills(
  config: GhqWsConfig,
): Promise<PlannedAgentSkills> {
  const providers = getEnabledAgentSkillProviders(config);
  const emptySummary = createEmptySummary();

  if (providers.length === 0) {
    return {
      enabled: false,
      providers: [],
      discovered: [],
      selected: [],
      duplicateGroups: [],
      warnings: [],
      summary: emptySummary,
    };
  }

  const warnings: AgentSkillWarning[] = [];
  const discovered = (
    await Promise.all(
      config.repos.map((repo, order) =>
        discoverRepoAgentSkills(
          config.workspaceRoot,
          config.ghqRoot,
          repo,
          order,
          providers,
          warnings,
        ),
      ),
    )
  ).flat();

  const groups = new Map<string, DiscoveredAgentSkill[]>();
  const selected: DiscoveredAgentSkill[] = [];
  const duplicateGroups: AgentSkillDuplicateGroup[] = [];

  for (const skill of discovered) {
    const key = skill.normalizedName
      ? `${skill.provider}:${skill.normalizedName}`
      : `${skill.provider}:${skill.skillDirectoryName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(skill);
    } else {
      groups.set(key, [skill]);
    }
  }

  const sortedKeys = [...groups.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  for (const key of sortedKeys) {
    const entries = groups.get(key) ?? [];
    entries.sort((left, right) => {
      if (left.repo.order !== right.repo.order) {
        return left.repo.order - right.repo.order;
      }
      return left.sourcePath.localeCompare(right.sourcePath);
    });

    if (entries.length === 0) {
      continue;
    }

    selected.push(entries[0]);
    if (entries.length > 1) {
      const skipped = entries.slice(1);
      duplicateGroups.push({
        provider: entries[0].provider,
        key: entries[0].normalizedName ?? entries[0].skillDirectoryName,
        selected: entries[0],
        skipped,
        sameDescription: entries.every(
          (entry) =>
            entry.normalizedDescription === entries[0].normalizedDescription,
        ),
      });
    }
  }

  selected.sort((left, right) =>
    left.destinationPath.localeCompare(right.destinationPath),
  );

  const summary = createEmptySummary();
  summary.discoveredCount = discovered.length;
  summary.selectedCount = selected.length;
  summary.duplicateCount = duplicateGroups.reduce(
    (count, group) => count + group.skipped.length,
    0,
  );
  summary.warningCount = warnings.length;

  for (const provider of providers) {
    summary.byProvider[provider].discoveredCount = discovered.filter(
      (skill) => skill.provider === provider,
    ).length;
    summary.byProvider[provider].selectedCount = selected.filter(
      (skill) => skill.provider === provider,
    ).length;
    summary.byProvider[provider].duplicateCount = duplicateGroups
      .filter((group) => group.provider === provider)
      .reduce((count, group) => count + group.skipped.length, 0);
    summary.byProvider[provider].warningCount = warnings.filter(
      (warning) => warning.provider === provider,
    ).length;
  }

  return {
    enabled: true,
    providers,
    discovered,
    selected,
    duplicateGroups,
    warnings,
    summary,
  };
}

async function discoverRepoAgentSkills(
  workspaceRoot: string,
  ghqRoot: string,
  repo: GhqWsRepoConfig,
  order: number,
  providers: AgentSkillProvider[],
  warnings: AgentSkillWarning[],
): Promise<DiscoveredAgentSkill[]> {
  const repoRoot = getRepoSourcePath(ghqRoot, repo);
  const repoLabel = `${repo.provider}/${repo.owner}/${repo.name}`;
  const skills: DiscoveredAgentSkill[] = [];

  for (const provider of providers) {
    const providerRoot = path.join(repoRoot, `.${provider}`, "skills");
    let entries: { name: string; isDirectory(): boolean }[];

    try {
      entries = (await readdir(providerRoot, {
        withFileTypes: true,
        encoding: "utf8",
      })) as unknown as { name: string; isDirectory(): boolean }[];
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourcePath = path.join(providerRoot, entry.name);
      const skillMarkdownPath = path.join(sourcePath, "SKILL.md");
      let body: string;

      try {
        body = await readFile(skillMarkdownPath, "utf8");
      } catch {
        continue;
      }

      const frontmatterResult = parseSkillFrontmatter(body);
      if (frontmatterResult.warning) {
        warnings.push({
          type: "frontmatter-parse",
          provider,
          repo: repoLabel,
          skillDirectoryName: entry.name,
          skillPath: sourcePath,
          message: frontmatterResult.warning,
        });
      }

      const normalizedName = normalizeSkillValue(
        frontmatterResult.frontmatter.name,
      );
      if (!normalizedName) {
        warnings.push({
          type: "missing-name",
          provider,
          repo: repoLabel,
          skillDirectoryName: entry.name,
          skillPath: sourcePath,
          message: "SKILL.md frontmatter.name is missing",
        });
      }

      skills.push({
        provider,
        repo: {
          provider: repo.provider,
          owner: repo.owner,
          name: repo.name,
          order,
          label: repoLabel,
        },
        skillDirectoryName: entry.name,
        sourcePath,
        skillMarkdownPath,
        destinationPath: path.join(
          workspaceRoot,
          `.${provider}`,
          "skills",
          entry.name,
        ),
        frontmatter: frontmatterResult.frontmatter,
        normalizedName,
        normalizedDescription: normalizeSkillValue(
          frontmatterResult.frontmatter.description,
        ),
      });
    }
  }

  return skills;
}

function parseSkillFrontmatter(content: string): {
  frontmatter: AgentSkillFrontmatter;
  warning: string | null;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, warning: null };
  }

  const endIndex = normalized.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return {
      frontmatter: {},
      warning: "SKILL.md frontmatter start found without a closing delimiter",
    };
  }

  const rawFrontmatter = normalized.slice(4, endIndex);
  try {
    const parsed = YAML.parse(rawFrontmatter);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        frontmatter: {},
        warning: "SKILL.md frontmatter is not an object",
      };
    }

    return {
      frontmatter: {
        name: typeof parsed.name === "string" ? parsed.name : undefined,
        description:
          typeof parsed.description === "string"
            ? parsed.description
            : undefined,
      },
      warning: null,
    };
  } catch (error) {
    return {
      frontmatter: {},
      warning:
        error instanceof Error
          ? `failed to parse SKILL.md frontmatter: ${error.message}`
          : "failed to parse SKILL.md frontmatter",
    };
  }
}

function normalizeSkillValue(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function createEmptySummary(): PlannedAgentSkills["summary"] {
  return {
    discoveredCount: 0,
    selectedCount: 0,
    duplicateCount: 0,
    warningCount: 0,
    byProvider: {
      agents: {
        discoveredCount: 0,
        selectedCount: 0,
        duplicateCount: 0,
        warningCount: 0,
      },
      claude: {
        discoveredCount: 0,
        selectedCount: 0,
        duplicateCount: 0,
        warningCount: 0,
      },
    },
  };
}
