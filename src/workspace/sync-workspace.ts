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
  assertSafePath,
  destinationKey,
  installLink,
  type ManagedLink,
  observedOwnedLinks,
  readLinkManifest,
  removeRecordedLink,
  statIfPresent,
  usesCaseInsensitivePaths,
  withWorkspaceSyncLease,
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
  return withWorkspaceSyncLease(config.workspaceRoot, () =>
    syncWorkspaceWithLease(config),
  );
}

export function assertWorkspaceLinkLayout(
  config: GhqWsConfig,
  links: ManagedLink[],
  caseInsensitive = false,
) {
  const workspaceRoot = config.workspaceRoot;
  assertDistinctLinks(
    [
      ...links,
      ...[
        "repo-links-manifest.json",
        "agent-skills-manifest.json",
        "agent-skills-report.json",
        "agent-skills-report.md",
      ].map((filename) => ({
        destinationPath: path.join(workspaceRoot, ".ghq-sector", filename),
        sourcePath: "",
      })),
      {
        destinationPath: path.join(workspaceRoot, ".ghq-sector-sync.lock"),
        sourcePath: "",
      },
    ],
    caseInsensitive,
  );
  assertLinkDirectories(
    links,
    [
      ...config.categories.map((category) =>
        path.join(workspaceRoot, category),
      ),
      ...links.map((link) => path.dirname(link.destinationPath)),
      path.join(workspaceRoot, ".ghq-sector"),
    ],
    caseInsensitive,
  );
}

export async function prepareWorkspaceSync(config: GhqWsConfig) {
  const { workspaceRoot, ghqRoot } = config;
  const links = config.repos.map((repo) => ({
    sourcePath: getRepoSourcePath(ghqRoot, repo),
    destinationPath: getRepoDestinationPath(workspaceRoot, repo),
  }));
  const agentSkillPlan = await planAgentSkills(config);
  const allLinks = [...links, ...agentSkillPlan.selected];
  await assertDirectory(workspaceRoot, workspaceRoot);
  const caseInsensitive = await usesCaseInsensitivePaths(workspaceRoot);
  assertWorkspaceLinkLayout(config, allLinks, caseInsensitive);
  const manifestPath = path.join(
    workspaceRoot,
    ".ghq-sector",
    "repo-links-manifest.json",
  );
  await assertMetadataFile(workspaceRoot, manifestPath);
  const previous = await readLinkManifest(manifestPath);
  for (const category of config.categories)
    await assertDirectory(workspaceRoot, path.join(workspaceRoot, category));
  for (const link of links)
    await assertLink(workspaceRoot, link, previous, caseInsensitive);
  const desired = new Set(
    links.map((link) => destinationKey(link.destinationPath, caseInsensitive)),
  );
  const staleRepos = previous.filter(
    (link) =>
      !desired.has(destinationKey(link.destinationPath, caseInsensitive)),
  );
  for (const link of staleRepos)
    await assertSafePath(workspaceRoot, link.destinationPath);
  const preparedSkills = await prepareAgentSkillsSync(
    workspaceRoot,
    agentSkillPlan,
    caseInsensitive,
  );
  if (staleRepos.length || preparedSkills.stale.length)
    assertWorkspaceLinkLayout(
      config,
      [...allLinks, ...staleRepos, ...preparedSkills.stale],
      caseInsensitive,
    );
  return {
    links,
    manifestPath,
    previous,
    agentSkillPlan,
    preparedSkills,
    staleRepos,
    caseInsensitive,
  };
}

async function syncWorkspaceWithLease(
  config: GhqWsConfig,
): Promise<SyncWorkspaceResult> {
  const { workspaceRoot, ghqRoot } = config;
  const linked: string[] = [];
  const skipped: string[] = [];
  const {
    links,
    manifestPath,
    previous,
    agentSkillPlan,
    preparedSkills,
    staleRepos,
    caseInsensitive,
  } = await prepareWorkspaceSync(config);
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

    await installLink(
      workspaceRoot,
      { sourcePath, destinationPath },
      previous,
      caseInsensitive,
    );
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

  for (const link of staleRepos) {
    if (
      !(await removeRecordedLink(workspaceRoot, link)) &&
      (await statIfPresent(link.destinationPath))
    )
      warn(
        `preserve stale repo: ${link.destinationPath} (not a matching recorded symlink)`,
      );
  }
  await writeLinkManifest(
    workspaceRoot,
    manifestPath,
    await observedOwnedLinks(workspaceRoot, links, previous, caseInsensitive),
  );
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
