import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GhqWsConfig } from "../src/config/schema.js";
import { planAgentSkills } from "../src/workspace/agent-skills.js";
import { syncAgentSkills } from "../src/workspace/sync-agent-skills.js";
import { createConfig, makeTempRoot } from "./helpers.js";

async function writeSkill(
  repoRoot: string,
  provider: "agents" | "claude",
  skillName: string,
  content: string,
) {
  const skillRoot = path.join(repoRoot, `.${provider}`, "skills", skillName);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), content, "utf8");
  return skillRoot;
}

describe("agent skills planning", () => {
  it("discovers .agents and .claude skills, ignores directories without SKILL.md, and resolves duplicates by repo order", async () => {
    const root = await makeTempRoot();
    const config: GhqWsConfig = {
      ...createConfig(root),
      agentSkills: {
        enabled: true,
        providers: ["agents", "claude"],
      },
    };
    const firstRepoRoot = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "life",
    );
    const secondRepoRoot = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "dotfiles",
    );

    await writeSkill(
      firstRepoRoot,
      "agents",
      "release-flow",
      `---\nname: Shared Skill\ndescription: first\n---\n# First\n`,
    );
    await writeSkill(
      firstRepoRoot,
      "claude",
      "claude-helper",
      `---\nname: Claude Helper\ndescription: claude\n---\n# Claude\n`,
    );
    await mkdir(path.join(firstRepoRoot, ".agents", "skills", "missing-file"), {
      recursive: true,
    });
    await writeSkill(
      secondRepoRoot,
      "agents",
      "duplicate-release-flow",
      `---\nname: Shared Skill\ndescription: second\n---\n# Second\n`,
    );
    await writeSkill(
      secondRepoRoot,
      "agents",
      "missing-name",
      `---\ndescription: unnamed\n---\n# Missing\n`,
    );

    const plan = await planAgentSkills(config);

    expect(plan.enabled).toBe(true);
    expect(plan.summary.discoveredCount).toBe(4);
    expect(plan.summary.selectedCount).toBe(3);
    expect(plan.summary.duplicateCount).toBe(1);
    expect(plan.summary.warningCount).toBe(1);
    expect(plan.summary.byProvider.agents).toMatchObject({
      discoveredCount: 3,
      selectedCount: 2,
      duplicateCount: 1,
      warningCount: 1,
    });
    expect(plan.summary.byProvider.claude).toMatchObject({
      discoveredCount: 1,
      selectedCount: 1,
      duplicateCount: 0,
      warningCount: 0,
    });
    expect(plan.duplicateGroups).toHaveLength(1);
    expect(plan.duplicateGroups[0]?.selected.repo.label).toBe(
      "github.com/ts-76/life",
    );
    expect(
      plan.duplicateGroups[0]?.skipped.map((entry) => entry.repo.label),
    ).toEqual(["github.com/ts-76/dotfiles"]);
    expect(plan.warnings).toMatchObject([
      {
        type: "missing-name",
        provider: "agents",
        skillDirectoryName: "missing-name",
      },
    ]);
    expect(plan.selected.map((entry) => entry.destinationPath)).toEqual([
      path.join(config.workspaceRoot, ".agents", "skills", "missing-name"),
      path.join(config.workspaceRoot, ".agents", "skills", "release-flow"),
      path.join(config.workspaceRoot, ".claude", "skills", "claude-helper"),
    ]);
  });

  it("reports frontmatter parse warnings and keeps the skill discoverable", async () => {
    const root = await makeTempRoot();
    const baseConfig = createConfig(root);
    const firstRepo = baseConfig.repos[0];
    if (!firstRepo) {
      throw new Error("expected fixture repo");
    }
    const config: GhqWsConfig = {
      ...baseConfig,
      repos: [firstRepo],
      agentSkills: {
        enabled: true,
        providers: ["agents"],
      },
    };
    const repoRoot = path.join(config.ghqRoot, "github.com", "ts-76", "life");

    await writeSkill(
      repoRoot,
      "agents",
      "broken-frontmatter",
      `---\nname: [\n---\n# Broken\n`,
    );

    const plan = await planAgentSkills(config);

    expect(plan.summary.discoveredCount).toBe(1);
    expect(plan.summary.warningCount).toBe(2);
    expect(plan.warnings.map((warning) => warning.type)).toEqual([
      "frontmatter-parse",
      "missing-name",
    ]);
  });
});

describe("agent skills syncing", () => {
  it("creates links, removes stale managed links, preserves unrelated files, and writes reports", async () => {
    const root = await makeTempRoot();
    const config: GhqWsConfig = {
      ...createConfig(root),
      agentSkills: {
        enabled: true,
        providers: ["agents", "claude"],
      },
    };
    const firstRepoRoot = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "life",
    );
    const secondRepoRoot = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "dotfiles",
    );

    const selectedAgentsSource = await writeSkill(
      firstRepoRoot,
      "agents",
      "release-flow",
      `---\nname: Release Flow\ndescription: first\n---\n# First\n`,
    );
    await writeSkill(
      secondRepoRoot,
      "agents",
      "release-flow-duplicate",
      `---\nname: Release Flow\ndescription: duplicate\n---\n# Duplicate\n`,
    );
    await writeSkill(
      secondRepoRoot,
      "claude",
      "review-helper",
      `---\nname: Review Helper\ndescription: claude\n---\n# Claude\n`,
    );

    const plan = await planAgentSkills(config);
    const staleManagedTarget = path.join(
      config.workspaceRoot,
      ".agents",
      "skills",
      "old-skill",
    );
    const unrelatedFile = path.join(
      config.workspaceRoot,
      ".agents",
      "settings.json",
    );
    const unrelatedNestedFile = path.join(
      config.workspaceRoot,
      ".claude",
      "skills",
      "README.txt",
    );

    await mkdir(path.dirname(staleManagedTarget), { recursive: true });
    await mkdir(path.dirname(unrelatedFile), { recursive: true });
    await mkdir(path.dirname(unrelatedNestedFile), { recursive: true });
    await symlink(selectedAgentsSource, staleManagedTarget, "dir");
    await writeFile(unrelatedFile, "keep", "utf8");
    await writeFile(unrelatedNestedFile, "keep", "utf8");

    // Write a previous manifest so syncAgentSkills knows the stale link is managed
    const manifestDir = path.join(config.workspaceRoot, ".ghq-sector");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      path.join(manifestDir, "agent-skills-manifest.json"),
      JSON.stringify([staleManagedTarget]),
      "utf8",
    );

    const result = await syncAgentSkills(config.workspaceRoot, plan);
    const agentsDestination = path.join(
      config.workspaceRoot,
      ".agents",
      "skills",
      "release-flow",
    );
    const claudeDestination = path.join(
      config.workspaceRoot,
      ".claude",
      "skills",
      "review-helper",
    );
    const reportJson = JSON.parse(
      await readFile(result.reports.json, "utf8"),
    ) as {
      summary: { duplicateCount: number };
      duplicates: Array<{
        selected: { repo: string };
        skipped: Array<{ repo: string }>;
      }>;
    };
    const reportMarkdown = await readFile(result.reports.markdown, "utf8");

    expect(result.linked).toEqual([agentsDestination, claudeDestination]);
    expect(result.removed).toEqual([staleManagedTarget]);
    expect((await lstat(agentsDestination)).isSymbolicLink()).toBe(true);
    expect((await lstat(claudeDestination)).isSymbolicLink()).toBe(true);
    expect(await readFile(unrelatedFile, "utf8")).toBe("keep");
    expect(await readFile(unrelatedNestedFile, "utf8")).toBe("keep");
    expect(reportJson.summary.duplicateCount).toBe(1);
    expect(reportJson.duplicates).toMatchObject([
      {
        selected: { repo: "github.com/ts-76/life" },
        skipped: [{ repo: "github.com/ts-76/dotfiles" }],
      },
    ]);
    expect(reportMarkdown).toContain("# Agent skills report");
    expect(reportMarkdown).toContain("release flow");
    expect(reportMarkdown).toContain("review-helper");
    expect(result.summary.byProvider.agents.linkedCount).toBe(1);
    expect(result.summary.byProvider.claude.linkedCount).toBe(1);
  });
});
