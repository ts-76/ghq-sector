import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import type { GhqWsConfig } from "../config/schema.js";
import { runHooks } from "../hooks/run-hooks.js";
import { warn } from "../shared/logger.js";
import {
  getRepoDestinationPath,
  getRepoSourcePath,
} from "../shared/repo-paths.js";
import { planAgentSkills } from "./agent-skills.js";
import {
  assertDirectory,
  assertDistinctLinks,
  assertLink,
  assertLinkDirectories,
  assertMetadataFile,
  installLink,
  readLinkManifest,
  usesCaseInsensitivePaths,
  writeLinkManifest,
} from "./safe-links.js";
import {
  prepareAgentSkillsSync,
  syncAgentSkills,
} from "./sync-agent-skills.js";

export interface SyncWorkspaceResult {
  workspaceRoot: string;
  linked: string[];
  skipped: string[];
  agentSkills: {
    linked: string[];
    removed: string[];
    duplicateCount: number;
    warningCount: number;
    reports: {
      json: string;
      markdown: string;
    };
    byProvider: {
      agents: { linkedCount: number };
      claude: { linkedCount: number };
    };
  };
}

export async function syncWorkspace(
  config: GhqWsConfig,
): Promise<SyncWorkspaceResult> {
  const workspaceRoot = config.workspaceRoot;
  const ghqRoot = config.ghqRoot;
  const linked: string[] = [];
  const skipped: string[] = [];

  const links = config.repos.map((repo) => ({
    sourcePath: getRepoSourcePath(ghqRoot, repo),
    destinationPath: getRepoDestinationPath(workspaceRoot, repo),
  }));
  const agentSkillPlan = await planAgentSkills(config);
  const allLinks = [...links, ...agentSkillPlan.selected];
  const caseInsensitive = await usesCaseInsensitivePaths(workspaceRoot);
  assertDistinctLinks(
    [
      ...allLinks,
      ...[
        "repo-links-manifest.json",
        "agent-skills-manifest.json",
        "agent-skills-report.json",
        "agent-skills-report.md",
      ].map((filename) => ({
        destinationPath: path.join(workspaceRoot, ".ghq-sector", filename),
        sourcePath: "",
      })),
    ],
    caseInsensitive,
  );
  assertLinkDirectories(
    allLinks,
    [
      ...config.categories.map((category) =>
        path.join(workspaceRoot, category),
      ),
      ...allLinks.map((link) => path.dirname(link.destinationPath)),
      path.join(workspaceRoot, ".ghq-sector"),
    ],
    caseInsensitive,
  );
  await assertDirectory(workspaceRoot, workspaceRoot);
  const manifestPath = path.join(
    workspaceRoot,
    ".ghq-sector",
    "repo-links-manifest.json",
  );
  await assertMetadataFile(workspaceRoot, manifestPath);
  const previous = await readLinkManifest(manifestPath);
  for (const category of config.categories)
    await assertDirectory(workspaceRoot, path.join(workspaceRoot, category));
  for (const link of links) await assertLink(workspaceRoot, link, previous);
  const preparedSkills = await prepareAgentSkillsSync(
    workspaceRoot,
    agentSkillPlan,
  );
  assertDistinctLinks([...allLinks, ...preparedSkills.stale], caseInsensitive);
  // All destinations (including missing sources and skills) are validated first.
  await mkdir(workspaceRoot, { recursive: true });
  for (const category of config.categories)
    await mkdir(path.join(workspaceRoot, category), { recursive: true });

  for (const repo of config.repos) {
    const sourcePath = getRepoSourcePath(ghqRoot, repo);
    const destinationPath = getRepoDestinationPath(workspaceRoot, repo);

    try {
      await access(sourcePath);
    } catch {
      warn(`skip missing source: ${sourcePath}`);
      skipped.push(sourcePath);
      continue;
    }

    await installLink(workspaceRoot, { sourcePath, destinationPath }, previous);
    linked.push(destinationPath);

    await runHooks(config.hooks?.afterLink, {
      provider: repo.provider,
      owner: repo.owner,
      repo: repo.name,
      category: repo.category,
      ghqPath: sourcePath,
      workspacePath: destinationPath,
      ghqRoot,
      workspaceRoot,
    });
  }

  await writeLinkManifest(workspaceRoot, manifestPath, links);
  const agentSkillResult = await syncAgentSkills(
    workspaceRoot,
    agentSkillPlan,
    preparedSkills,
  );

  await runHooks(config.hooks?.afterSync, {
    ghqRoot,
    workspaceRoot,
    linkedCount: linked.length,
  });

  return {
    workspaceRoot,
    linked,
    skipped,
    agentSkills: {
      linked: agentSkillResult.linked,
      removed: agentSkillResult.removed,
      duplicateCount: agentSkillResult.summary.duplicateCount,
      warningCount: agentSkillResult.summary.warningCount,
      reports: agentSkillResult.reports,
      byProvider: agentSkillResult.summary.byProvider,
    },
  };
}
