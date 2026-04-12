import os from "node:os";
import { mkdir } from "node:fs/promises";
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
