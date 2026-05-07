import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createConfigTemplate } from "../src/config/template.js";
import { parseConfig } from "../src/config/validate-config.js";
import { createConfig, importFresh, makeTempRoot } from "./helpers.js";

describe("config validation", () => {
  it("rejects repos whose category does not exist in categories", () => {
    expect(() =>
      parseConfig({
        ghqRoot: "/ghq",
        workspaceRoot: "/workspace",
        categories: ["projects", "tools"],
        repos: [
          {
            provider: "github.com",
            owner: "ts-76",
            name: "life",
            category: "docs",
          },
        ],
      }),
    ).toThrow("invalid config: repo categories must exist in categories");
  });

  it("strips matching wrapping quotes across nested config strings", () => {
    const config = parseConfig({
      ghqRoot: '"/ghq"',
      workspaceRoot: "'/workspace'",
      categories: ['"projects"', "'tools'"],
      repos: [
        {
          provider: '"github.com"',
          owner: "'ts-76'",
          name: '"life"',
          category: "'projects'",
        },
      ],
      hooks: {
        afterInit: ['"echo "hi""'],
      },
      resources: [
        {
          from: '"workspace-template"',
          to: "'./templates'",
          mode: '"755"',
        },
      ],
      defaults: {
        provider: '"github.com"',
        owner: "'ts-76'",
        category: '"projects"',
      },
      editor: {
        codeWorkspace: {
          filename: '"main.code-workspace"',
        },
      },
    });

    expect(config).toMatchObject({
      ghqRoot: "/ghq",
      workspaceRoot: "/workspace",
      categories: ["projects", "tools"],
      repos: [
        {
          provider: "github.com",
          owner: "ts-76",
          name: "life",
          category: "projects",
        },
      ],
      hooks: {
        afterInit: ['echo "hi"'],
      },
      resources: [
        {
          from: "workspace-template",
          to: "./templates",
          mode: "755",
        },
      ],
      defaults: {
        provider: "github.com",
        owner: "ts-76",
        category: "projects",
      },
      editor: {
        codeWorkspace: {
          filename: "main.code-workspace",
        },
      },
    });
  });

  it("creates template config with generic default categories", () => {
    const template = createConfigTemplate("/ghq", "/workspace", "ts-76");

    expect(template.categories).toEqual(["projects", "tools", "docs"]);
    expect(template.defaults?.category).toBe("projects");
    expect(template.agentSkills).toEqual({
      enabled: false,
      providers: ["agents", "claude"],
    });
  });

  it("exposes optional repo descriptions in the JSON schema", async () => {
    const { buildJsonSchema } = await import(
      "../src/config/build-json-schema.js"
    );

    const schema = buildJsonSchema();
    const repoDescription =
      schema.properties?.repos.items?.properties?.description;

    expect(repoDescription).toMatchObject({
      type: "string",
      description:
        "Optional short repository summary used first in generated AGENTS.md directory listings.",
    });
  });
});

describe("portable path helpers", () => {
  it("collapses current-home absolute roots back to tilde form", async () => {
    const { normalizePortableConfig } = await import(
      "../src/config/machine-paths.js"
    );
    const home = os.homedir();
    const config = createConfig(home);
    const absoluteConfig = {
      ...config,
      ghqRoot: path.join(home, "ghq"),
      workspaceRoot: path.join(home, "workspace", "sub"),
    };

    expect(normalizePortableConfig(absoluteConfig)).toMatchObject({
      ghqRoot: "~/ghq",
      workspaceRoot: "~/workspace/sub",
    });
  });

  it("keeps already-portable tilde paths stable across repeated normalization", async () => {
    const { normalizePortableConfig } = await import(
      "../src/config/machine-paths.js"
    );

    const config = {
      ...createConfig("/tmp/project"),
      ghqRoot: "~/ghq",
      workspaceRoot: "~/workspace/sub",
    };

    expect(normalizePortableConfig(config)).toMatchObject({
      ghqRoot: "~/ghq",
      workspaceRoot: "~/workspace/sub",
    });
    expect(
      normalizePortableConfig(normalizePortableConfig(config)),
    ).toMatchObject({
      ghqRoot: "~/ghq",
      workspaceRoot: "~/workspace/sub",
    });
  });

  it("remaps foreign home paths to the current machine and prefers detected ghq root", async () => {
    vi.doMock("../src/shared/ghq.js", () => ({
      getGhqRoot: vi.fn(async () => "/opt/ghq"),
    }));

    const { getRuntimePaths } = await import("../src/config/machine-paths.js");
    const runtimePaths = await getRuntimePaths({
      ...createConfig("/tmp/project"),
      ghqRoot: "/Users/other/ghq",
      workspaceRoot: "/Users/other/workspace/sub",
    });

    expect(runtimePaths).toMatchObject({
      configuredGhqRoot: "/Users/other/ghq",
      configuredWorkspaceRoot: "/Users/other/workspace/sub",
      resolvedGhqRoot: "/opt/ghq",
      resolvedWorkspaceRoot: path.join(os.homedir(), "workspace", "sub"),
    });
  });

  it("remaps a foreign absolute home root to the current home root", async () => {
    const { remapPortableHomePath } = await import("../src/shared/paths.js");

    expect(remapPortableHomePath("/Users/other")).toBe(os.homedir());
  });
});

describe("workspace planning", () => {
  it("marks missing repos as fetch and sorts links/folders by category and name", async () => {
    vi.doUnmock("../src/config/machine-paths.js");
    vi.doUnmock("../src/shared/ghq.js");
    const root = await makeTempRoot();
    const config = {
      ...createConfig(root),
      ghqRoot: "/Users/other/ghq",
      workspaceRoot: "/Users/other/workspace/sub",
    };
    const runtimeGhqRoot = path.join(root, "runtime-ghq");

    await mkdir(path.join(runtimeGhqRoot, "github.com", "ts-76", "life"), {
      recursive: true,
    });

    vi.doMock("../src/shared/ghq.js", () => ({
      getGhqRoot: vi.fn(async () => runtimeGhqRoot),
    }));

    const workspaceModule = await importFresh<
      typeof import("../src/workspace/plan-workspace.js")
    >("../src/workspace/plan-workspace.js");
    const plan = await workspaceModule.planWorkspace(config);
    const workspacePlan = workspaceModule.buildCodeWorkspacePlan({
      ...config,
      workspaceRoot: path.join(os.homedir(), "workspace", "sub"),
    });

    expect(plan.summary).toEqual({
      totalRepos: 2,
      linkableRepos: 1,
      missingRepos: 1,
      resourcesCount: 0,
      agentSkillsDiscoveredCount: 0,
      agentSkillsLinkedCount: 0,
      agentSkillsDuplicateCount: 0,
      agentSkillsWarningCount: 0,
    });
    expect(
      plan.repoLinks.map((repo: { name: string; status: string }) => ({
        name: repo.name,
        status: repo.status,
      })),
    ).toEqual([
      { name: "life", status: "ready" },
      { name: "dotfiles", status: "fetch" },
    ]);
    expect(workspacePlan.folders).toEqual([
      { path: "projects/life" },
      { path: "tools/dotfiles" },
    ]);
  });
});

describe("AGENTS.md generation", () => {
  it("creates AGENTS.md from config when missing", async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    await mkdir(path.join(config.ghqRoot, "github.com", "ts-76", "life"), {
      recursive: true,
    });
    await mkdir(path.join(config.ghqRoot, "github.com", "ts-76", "dotfiles"), {
      recursive: true,
    });
    await writeFile(
      path.join(config.ghqRoot, "github.com", "ts-76", "life", "package.json"),
      JSON.stringify({
        description: "Personal knowledge and automation toolkit",
      }),
      "utf8",
    );
    await writeFile(
      path.join(config.ghqRoot, "github.com", "ts-76", "dotfiles", "README.md"),
      "# Dotfiles\n\nShell and editor settings.\n",
      "utf8",
    );
    const { generateAgentsMd } = await import(
      "../src/workspace/generate-agents-md.js"
    );

    const agentsMdPath = await generateAgentsMd(config);
    const content = await readFile(agentsMdPath, "utf8");

    expect(agentsMdPath).toBe(path.join(config.workspaceRoot, "AGENTS.md"));
    expect(content).toContain("# AGENTS.md");
    expect(content).toContain("<!-- ghq-sector:start -->");
    expect(content).toContain("projects/");
    expect(content).toContain("  life/ - Personal knowledge and automa…");
    expect(content).toContain("tools/");
    expect(content).toContain("  dotfiles/ - Dotfiles");
    expect(content).toContain("docs/");
  });

  it("updates only the managed block and removes entries no longer in config", async () => {
    const root = await makeTempRoot();
    const baseConfig = createConfig(root);
    await mkdir(baseConfig.workspaceRoot, { recursive: true });
    const agentsMdPath = path.join(baseConfig.workspaceRoot, "AGENTS.md");
    await writeFile(
      agentsMdPath,
      `# Existing instructions\n\nKeep this.\n\n<!-- ghq-sector:start -->\nold/\n  stale/ - github.com/old/stale\n<!-- ghq-sector:end -->\n\nKeep this too.\n`,
      "utf8",
    );
    await mkdir(path.join(baseConfig.ghqRoot, "github.com", "ts-76", "life"), {
      recursive: true,
    });
    await writeFile(
      path.join(baseConfig.ghqRoot, "github.com", "ts-76", "life", "README.md"),
      "# Life\n",
      "utf8",
    );
    const config = {
      ...baseConfig,
      categories: ["projects"],
      repos: [baseConfig.repos[0]],
    };
    const { generateAgentsMd } = await import(
      "../src/workspace/generate-agents-md.js"
    );

    await generateAgentsMd(config);
    const content = await readFile(agentsMdPath, "utf8");

    expect(content).toContain("Keep this.");
    expect(content).toContain("Keep this too.");
    expect(content).toContain("projects/");
    expect(content).toContain("  life/ - Life");
    expect(content).not.toContain("old/");
    expect(content).not.toContain("stale/");
    expect(content).not.toContain("tools/");
    expect(content).not.toContain("dotfiles/");
  });
});
