import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConfigTemplate } from "../src/config/template.js";
import { parseConfig } from "../src/config/validate-config.js";
import {
  buildCodeWorkspacePlan,
  planWorkspace,
} from "../src/workspace/plan-workspace.js";
import { createConfig, makeTempRoot } from "./helpers.js";

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

describe("workspace planning", () => {
  it("marks missing repos as fetch and sorts links/folders by category and name", async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);

    await mkdir(path.join(config.ghqRoot, "github.com", "ts-76", "life"), {
      recursive: true,
    });

    const plan = await planWorkspace(config);
    const workspacePlan = buildCodeWorkspacePlan(config);

    expect(plan.summary).toEqual({
      totalRepos: 2,
      linkableRepos: 1,
      missingRepos: 1,
      resourcesCount: 0,
    });
    expect(
      plan.repoLinks.map((repo) => ({ name: repo.name, status: repo.status })),
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
