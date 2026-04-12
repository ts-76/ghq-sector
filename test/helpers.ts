import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import type { GhqWsConfig } from "../src/config/schema.js";

const tempRoots: string[] = [];

export async function makeTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ghq-ws-test-"));
  tempRoots.push(root);
  return root;
}

export function createConfig(root: string): GhqWsConfig {
  return {
    ghqRoot: path.join(root, "ghq"),
    workspaceRoot: path.join(root, "workspace"),
    categories: ["projects", "tools", "docs"],
    repos: [
      {
        provider: "github.com",
        owner: "ts-76",
        name: "life",
        category: "projects",
      },
      {
        provider: "github.com",
        owner: "ts-76",
        name: "dotfiles",
        category: "tools",
      },
    ],
    hooks: {
      afterInit: [],
      beforeClone: [],
      afterClone: [],
      afterLink: [],
      afterSync: [],
    },
    resources: [],
    defaults: {
      provider: "github.com",
      owner: "ts-76",
      category: "projects",
    },
    editor: {
      codeWorkspace: {
        enabled: true,
        filename: "main.code-workspace",
      },
    },
  };
}

const mockedModules = [
  "../src/config/load-config.js",
  "../src/ghq/ensure-repos.js",
  "../src/commands/sync.js",
  "../src/commands/edit.js",
  "../src/config/copy-config-to-workspace.js",
  "../src/hooks/run-hooks.js",
  "../src/ghq/ghq-get.js",
  "../src/config/save-config.js",
  "../src/resources/copy-resources.js",
  "../src/shared/ghq.js",
  "../src/shared/gh.js",
  "../src/shared/prompt.js",
  "../src/workspace/generate-code-workspace.js",
] as const;

export async function importFresh<T>(specifier: string): Promise<T> {
  vi.resetModules();
  return import(specifier) as Promise<T>;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  for (const specifier of mockedModules) {
    vi.doUnmock(specifier);
  }
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});
