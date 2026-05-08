import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GhqWsConfig, GhqWsRepoConfig } from "../config/schema.js";
import { getRepoSourcePath } from "../shared/repo-paths.js";

const START_MARKER = "<!-- ghq-sector:start -->";
const END_MARKER = "<!-- ghq-sector:end -->";
const MAX_DESCRIPTION_LENGTH = 30;

export async function buildAgentsMdSection(config: GhqWsConfig) {
  const descriptionByRepo = new Map<string, string>();

  await Promise.all(
    config.repos.map(async (repo) => {
      descriptionByRepo.set(repoKey(repo), await getRepoSummary(config, repo));
    }),
  );

  const lines = [
    START_MARKER,
    "## ghq-sector workspace",
    "",
    "This section is managed by ghq-sector. Manual edits inside this block will be overwritten.",
    "",
    `- Workspace root: \`${config.workspaceRoot}\``,
    `- ghq root: \`${config.ghqRoot}\``,
    "",
    "### Directory structure",
    "",
    "```text",
    ".",
  ];

  for (const category of config.categories) {
    lines.push(`${category}/`);
    const repos = getReposForCategory(config.repos, category);
    for (const repo of repos) {
      lines.push(`  ${repo.name}/ - ${descriptionByRepo.get(repoKey(repo))}`);
    }
  }

  lines.push("```", "", END_MARKER, "");
  return `${lines.join("\n")}`;
}

export async function generateAgentsMd(config: GhqWsConfig) {
  const agentsMdPath = path.join(config.workspaceRoot, "AGENTS.md");
  const section = await buildAgentsMdSection(config);
  let existing = "";

  await mkdir(config.workspaceRoot, { recursive: true });

  try {
    existing = await readFile(agentsMdPath, "utf8");
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
    await writeFile(agentsMdPath, `# AGENTS.md\n\n${section}`, "utf8");
    return agentsMdPath;
  }

  const nextContent = replaceManagedSection(existing, section);
  await writeFile(agentsMdPath, nextContent, "utf8");
  return agentsMdPath;
}

function replaceManagedSection(existing: string, section: string) {
  const startIndex = existing.indexOf(START_MARKER);
  const endIndex =
    startIndex === -1
      ? -1
      : existing.indexOf(END_MARKER, startIndex + START_MARKER.length);

  if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
    const before = existing.slice(0, startIndex).trimEnd();
    const after = existing.slice(endIndex + END_MARKER.length).trimStart();
    return `${[before, section.trimEnd(), after].filter(Boolean).join("\n\n")}\n`;
  }

  return `${existing.trimEnd()}\n\n${section}`;
}

function isNodeErrorWithCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function getReposForCategory(repos: GhqWsRepoConfig[], category: string) {
  return repos
    .filter((repo) => repo.category === category)
    .sort((left, right) => {
      const ownerCompare = left.owner.localeCompare(right.owner);
      return ownerCompare !== 0
        ? ownerCompare
        : left.name.localeCompare(right.name);
    });
}

async function getRepoSummary(config: GhqWsConfig, repo: GhqWsRepoConfig) {
  const repoRoot = getRepoSourcePath(config.ghqRoot, repo);
  return (
    shortenSummary(repo.description ?? null) ??
    shortenSummary(await readPackageDescription(repoRoot)) ??
    shortenSummary(await readReadmeSummary(repoRoot)) ??
    "No description yet"
  );
}

async function readPackageDescription(repoRoot: string) {
  try {
    const content = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(content) as { description?: unknown };
    return typeof parsed.description === "string" ? parsed.description : null;
  } catch {
    return null;
  }
}

async function readReadmeSummary(repoRoot: string) {
  for (const filename of ["README.md", "README.ja.md", "readme.md"]) {
    try {
      const content = await readFile(path.join(repoRoot, filename), "utf8");
      const summary = extractReadmeSummary(content);
      if (summary) return summary;
    } catch {
      // Try the next README candidate.
    }
  }

  return null;
}

function extractReadmeSummary(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const normalized = line
      .replace(/^#+\s+/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/[`*_#[\]]/g, "")
      .replace(/\([^)]*\)/g, "")
      .trim();

    if (normalized && !normalized.startsWith("!") && normalized.length >= 4) {
      return normalized;
    }
  }

  return null;
}

function shortenSummary(summary: string | null) {
  if (!summary) return null;
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > MAX_DESCRIPTION_LENGTH
    ? `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
    : normalized;
}

function repoKey(repo: GhqWsRepoConfig) {
  return `${repo.provider}/${repo.owner}/${repo.name}`;
}
