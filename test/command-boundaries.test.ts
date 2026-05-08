import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GhqWsConfig } from "../src/config/schema.js";
import { createConfig, importFresh, makeTempRoot } from "./helpers.js";

describe("config loading", () => {
  it("loads a config when given a direct config file path", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "custom-config.json");
    const config = createConfig(root);

    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

    const { loadConfig } = await importFresh<
      typeof import("../src/config/load-config.js")
    >("../src/config/load-config.js");
    const loaded = await loadConfig(configPath);

    expect(loaded).toEqual({
      path: configPath,
      config,
    });
  });

  it("reports a missing direct config file as not found", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "missing-config.json");

    const { loadConfig } = await importFresh<
      typeof import("../src/config/load-config.js")
    >("../src/config/load-config.js");

    await expect(loadConfig(configPath)).rejects.toThrow(
      "config file not found",
    );
  });
});

describe("init workflow", () => {
  it("passes the created config path to runEdit when opening the editor", async () => {
    const root = await makeTempRoot();
    const cwd = path.join(root, "config-home");
    const ghqRoot = path.join(root, "ghq");
    const workspaceRoot = path.join(root, "workspace");
    const runEdit = vi.fn(async () => undefined);

    await mkdir(cwd, { recursive: true });

    vi.doMock("../src/shared/gh.js", () => ({
      listGhOwnerCandidates: vi.fn(async () => [
        { login: "ts-76", active: true },
      ]),
    }));
    vi.doMock("../src/shared/prompt.js", () => ({
      prompt: vi.fn(async () => "y"),
      selectFromChoices: vi.fn(async () => ({ index: 0 })),
    }));
    vi.doMock("../src/resources/copy-resources.js", () => ({
      copyResources: vi.fn(async () => []),
    }));
    vi.doMock("../src/workspace/generate-code-workspace.js", () => ({
      generateCodeWorkspace: vi.fn(async () => null),
    }));
    vi.doMock("../src/hooks/run-hooks.js", () => ({
      runHooks: vi.fn(async () => []),
    }));
    vi.doMock("../src/commands/edit.js", () => ({
      runEdit,
    }));

    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      const { runInit } = await importFresh<
        typeof import("../src/commands/init.js")
      >("../src/commands/init.js");

      await runInit({
        ghqRoot,
        workspaceRoot,
        format: "json",
      });

      expect(runEdit).toHaveBeenCalledWith({
        config: path.join(cwd, "ghq-sector.config.json"),
      });
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("preserves explicit non-home absolute roots during init", async () => {
    const root = await makeTempRoot();
    const cwd = path.join(root, "config-home");

    await mkdir(cwd, { recursive: true });

    vi.doMock("../src/shared/gh.js", () => ({
      listGhOwnerCandidates: vi.fn(async () => []),
    }));
    vi.doMock("../src/resources/copy-resources.js", () => ({
      copyResources: vi.fn(async () => []),
    }));
    vi.doMock("../src/workspace/generate-code-workspace.js", () => ({
      generateCodeWorkspace: vi.fn(async () => null),
    }));
    vi.doMock("../src/hooks/run-hooks.js", () => ({
      runHooks: vi.fn(async () => []),
    }));

    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      const { runInit } = await importFresh<
        typeof import("../src/commands/init.js")
      >("../src/commands/init.js");

      await runInit({
        ghqRoot: path.join(root, "ghq"),
        workspaceRoot: path.join(root, "workspace", "sub"),
        format: "json",
        yes: true,
      });

      const saved = JSON.parse(
        await readFile(path.join(cwd, "ghq-sector.config.json"), "utf8"),
      ) as GhqWsConfig;

      expect(saved.ghqRoot).toBe(path.join(root, "ghq"));
      expect(saved.workspaceRoot).toBe(path.join(root, "workspace", "sub"));
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("uses runtime-expanded workspace roots for init filesystem operations", async () => {
    const root = await makeTempRoot();
    const cwd = path.join(root, "config-home");
    const copyResources = vi.fn(async () => []);
    const generateCodeWorkspace = vi.fn(async () => null);

    await mkdir(cwd, { recursive: true });

    vi.doMock("../src/shared/gh.js", () => ({
      listGhOwnerCandidates: vi.fn(async () => []),
    }));
    vi.doMock("../src/resources/copy-resources.js", () => ({
      copyResources,
    }));
    vi.doMock("../src/workspace/generate-code-workspace.js", () => ({
      generateCodeWorkspace,
    }));
    vi.doMock("../src/hooks/run-hooks.js", () => ({
      runHooks: vi.fn(async () => []),
    }));

    const previousCwd = process.cwd();
    process.chdir(cwd);

    try {
      const { runInit } = await importFresh<
        typeof import("../src/commands/init.js")
      >("../src/commands/init.js");
      const home = process.env.HOME ?? "/home/test-user";

      await runInit({
        ghqRoot: "~/ghq",
        workspaceRoot: "~/workspace/sub",
        format: "json",
        yes: true,
      });

      expect(copyResources).toHaveBeenCalledWith(
        expect.objectContaining({
          ghqRoot: path.join(home, "ghq"),
          workspaceRoot: path.join(home, "workspace", "sub"),
        }),
        cwd,
      );
      expect(generateCodeWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          ghqRoot: path.join(home, "ghq"),
          workspaceRoot: path.join(home, "workspace", "sub"),
        }),
      );
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("apply workflow", () => {
  it("returns fetched/already-present repos and sync/copy results via runApply", async () => {
    const config = createConfig("/tmp/project");
    const runtimeConfig = {
      ...config,
      ghqRoot: "/detected/ghq",
      workspaceRoot: "/resolved/workspace",
    };

    const loadConfig = vi.fn(async () => ({
      path: "/tmp/project/ghq-sector.config.json",
      config,
    }));
    const ensureRepos = vi.fn(async () => ({
      fetched: ["github.com/ts-76/dotfiles"],
      alreadyPresent: ["github.com/ts-76/life"],
    }));
    const runSync = vi.fn(async () => ({
      configPath: "/tmp/project/ghq-sector.config.json",
      workspaceRoot: "/tmp/project/workspace",
      linkedCount: 2,
      skippedCount: 1,
      copiedResourcesCount: 3,
      codeWorkspacePath: "/tmp/project/workspace/main.code-workspace",
    }));
    const copyConfigToWorkspace = vi.fn(
      async () => "/tmp/project/workspace/ghq-sector.config.json",
    );

    vi.doMock("../src/config/load-config.js", () => ({ loadConfig }));
    vi.doMock("../src/config/machine-paths.js", () => ({
      getRuntimePaths: vi.fn(async () => ({
        configuredGhqRoot: config.ghqRoot,
        configuredWorkspaceRoot: config.workspaceRoot,
        resolvedGhqRoot: runtimeConfig.ghqRoot,
        resolvedWorkspaceRoot: runtimeConfig.workspaceRoot,
      })),
    }));
    vi.doMock("../src/ghq/ensure-repos.js", () => ({ ensureRepos }));
    vi.doMock("../src/commands/sync.js", () => ({ runSync }));
    vi.doMock("../src/config/copy-config-to-workspace.js", () => ({
      copyConfigToWorkspace,
    }));

    const { runApply } = await importFresh<
      typeof import("../src/commands/apply.js")
    >("../src/commands/apply.js");
    const result = await runApply("/tmp/project");

    expect(loadConfig).toHaveBeenCalledWith("/tmp/project");
    expect(ensureRepos).toHaveBeenCalledWith(runtimeConfig);
    expect(runSync).toHaveBeenCalledWith("/tmp/project", runtimeConfig);
    expect(copyConfigToWorkspace).toHaveBeenCalledWith(
      "/tmp/project/ghq-sector.config.json",
      runtimeConfig,
    );
    expect(result).toEqual({
      configPath: "/tmp/project/ghq-sector.config.json",
      workspaceRoot: "/tmp/project/workspace",
      linkedCount: 2,
      skippedCount: 1,
      copiedResourcesCount: 3,
      codeWorkspacePath: "/tmp/project/workspace/main.code-workspace",
      copiedConfigPath: "/tmp/project/workspace/ghq-sector.config.json",
      fetchedRepos: ["github.com/ts-76/dotfiles"],
      alreadyPresentRepos: ["github.com/ts-76/life"],
    });
  });

  it("passes a direct config path through runApply", async () => {
    const config = createConfig("/tmp/project");
    const directConfigPath = "/tmp/project/custom-config.json";

    const loadConfig = vi.fn(async () => ({
      path: directConfigPath,
      config,
    }));
    const ensureRepos = vi.fn(async () => ({
      fetched: [],
      alreadyPresent: [],
    }));
    const runSync = vi.fn(async () => ({
      configPath: directConfigPath,
      workspaceRoot: "/tmp/project/workspace",
      linkedCount: 2,
      skippedCount: 0,
      copiedResourcesCount: 0,
      codeWorkspacePath: "/tmp/project/workspace/main.code-workspace",
    }));
    const copyConfigToWorkspace = vi.fn(async () => directConfigPath);

    vi.doMock("../src/config/load-config.js", () => ({ loadConfig }));
    vi.doMock("../src/config/machine-paths.js", () => ({
      getRuntimePaths: vi.fn(async () => ({
        configuredGhqRoot: config.ghqRoot,
        configuredWorkspaceRoot: config.workspaceRoot,
        resolvedGhqRoot: config.ghqRoot,
        resolvedWorkspaceRoot: config.workspaceRoot,
      })),
    }));
    vi.doMock("../src/ghq/ensure-repos.js", () => ({ ensureRepos }));
    vi.doMock("../src/commands/sync.js", () => ({ runSync }));
    vi.doMock("../src/config/copy-config-to-workspace.js", () => ({
      copyConfigToWorkspace,
    }));

    const { runApply } = await importFresh<
      typeof import("../src/commands/apply.js")
    >("../src/commands/apply.js");

    await runApply(directConfigPath);

    expect(loadConfig).toHaveBeenCalledWith(directConfigPath);
    expect(runSync).toHaveBeenCalledWith(directConfigPath, config);
  });

  it("ghq gets only missing repos in ensureRepos and runs clone hooks around them", async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const presentSource = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "life",
    );
    const missingSource = path.join(
      config.ghqRoot,
      "github.com",
      "ts-76",
      "dotfiles",
    );
    const hookCalls: Array<Record<string, unknown>> = [];
    const ghqGet = vi.fn(async () => {
      await mkdir(missingSource, { recursive: true });
    });
    const runHooks = vi.fn(async (_hooks, variables) => {
      hookCalls.push(variables);
    });

    await mkdir(presentSource, { recursive: true });
    await mkdir(config.workspaceRoot, { recursive: true });

    vi.doMock("../src/ghq/ghq-get.js", () => ({ ghqGet }));
    vi.doMock("../src/hooks/run-hooks.js", () => ({ runHooks }));

    const { ensureRepos } = await importFresh<
      typeof import("../src/ghq/ensure-repos.js")
    >("../src/ghq/ensure-repos.js");

    const result = await ensureRepos(config);

    expect(result).toEqual({
      fetched: ["github.com/ts-76/dotfiles"],
      alreadyPresent: ["github.com/ts-76/life"],
    });
    expect(ghqGet).toHaveBeenCalledTimes(1);
    expect(ghqGet).toHaveBeenCalledWith("github.com/ts-76/dotfiles");
    expect(hookCalls).toEqual([
      {
        provider: "github.com",
        owner: "ts-76",
        repo: "dotfiles",
        category: "tools",
        ghqPath: missingSource,
        workspacePath: path.join(config.workspaceRoot, "tools", "dotfiles"),
        ghqRoot: config.ghqRoot,
        workspaceRoot: config.workspaceRoot,
      },
      {
        provider: "github.com",
        owner: "ts-76",
        repo: "dotfiles",
        category: "tools",
        ghqPath: missingSource,
        workspacePath: path.join(config.workspaceRoot, "tools", "dotfiles"),
        ghqRoot: config.ghqRoot,
        workspaceRoot: config.workspaceRoot,
      },
    ]);
  });
});

describe("clone workflow", () => {
  it("resolves runtime roots before clone-side repo and workspace operations", async () => {
    const config = {
      ...createConfig("/tmp/project"),
      ghqRoot: "/Users/other/ghq",
      workspaceRoot: "/Users/other/workspace/sub",
    };
    const runtimeConfig = {
      ...config,
      ghqRoot: "/resolved/ghq",
      workspaceRoot: "/resolved/workspace",
    };
    const saveConfig = vi.fn(async () => undefined);
    const ghqGet = vi.fn(async () => undefined);
    const syncWorkspace = vi.fn(async () => ({
      workspaceRoot: runtimeConfig.workspaceRoot,
      linked: ["one"],
      skipped: [],
      agentSkills: {
        linked: [],
        removed: [],
        duplicateCount: 0,
        warningCount: 0,
        reports: {
          json: "/resolved/workspace/.ghq-sector/agent-skills-report.json",
          markdown: "/resolved/workspace/.ghq-sector/agent-skills-report.md",
        },
        byProvider: {
          agents: { linkedCount: 0 },
          claude: { linkedCount: 0 },
        },
      },
    }));
    const copyResources = vi.fn(async () => []);
    const generateCodeWorkspace = vi.fn(async () => null);
    const runHooks = vi.fn(async () => []);
    const accessSpy = vi.fn(async () => undefined);

    vi.doMock("../src/config/machine-paths.js", () => ({
      resolveConfigForCurrentMachine: vi.fn(async () => runtimeConfig),
    }));
    vi.doMock("../src/config/save-config.js", () => ({ saveConfig }));
    vi.doMock("../src/ghq/ghq-get.js", () => ({ ghqGet }));
    vi.doMock("../src/workspace/sync-workspace.js", () => ({ syncWorkspace }));
    vi.doMock("../src/resources/copy-resources.js", () => ({ copyResources }));
    vi.doMock("../src/workspace/generate-code-workspace.js", () => ({
      generateCodeWorkspace,
    }));
    vi.doMock("../src/hooks/run-hooks.js", () => ({ runHooks }));
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        access: accessSpy,
      };
    });

    const { runClone } = await importFresh<
      typeof import("../src/commands/clone.js")
    >("../src/commands/clone.js");

    const result = await runClone(config, {
      repository: "owner/repo",
      category: "projects",
      configPath: "/tmp/project/ghq-sector.config.json",
      yes: true,
    });

    expect(accessSpy).toHaveBeenCalledWith(
      path.join(runtimeConfig.ghqRoot, "github.com", "owner", "repo"),
    );
    expect(runHooks).toHaveBeenCalledWith(
      runtimeConfig.hooks?.beforeClone,
      expect.objectContaining({
        ghqRoot: runtimeConfig.ghqRoot,
        workspaceRoot: runtimeConfig.workspaceRoot,
      }),
    );
    expect(saveConfig).toHaveBeenCalledWith(
      "/tmp/project/ghq-sector.config.json",
      expect.objectContaining({
        ghqRoot: runtimeConfig.ghqRoot,
        workspaceRoot: runtimeConfig.workspaceRoot,
      }),
    );
    expect(syncWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        ghqRoot: runtimeConfig.ghqRoot,
        workspaceRoot: runtimeConfig.workspaceRoot,
      }),
    );
    expect(result.sourcePath).toBe(
      path.join(runtimeConfig.ghqRoot, "github.com", "owner", "repo"),
    );
    expect(result.destinationPath).toBe(
      path.join(runtimeConfig.workspaceRoot, "projects", "repo"),
    );
  });
});

describe("sync workflow", () => {
  it("syncs workspace links, resources, and code workspace via runSync", async () => {
    const config = createConfig("/tmp/project");
    const resolvedConfig = {
      ...config,
      ghqRoot: "/resolved/ghq",
      workspaceRoot: "/resolved/workspace",
    };
    const loadConfig = vi.fn(async () => ({
      path: "/tmp/project/ghq-sector.config.json",
      config,
    }));
    const syncWorkspace = vi.fn(async () => ({
      workspaceRoot: resolvedConfig.workspaceRoot,
      linked: ["one", "two"],
      skipped: ["missing"],
      agentSkills: {
        linked: ["skill-one", "skill-two"],
        removed: [],
        duplicateCount: 1,
        warningCount: 2,
        reports: {
          json: "/tmp/project/workspace/.ghq-sector/agent-skills-report.json",
          markdown: "/tmp/project/workspace/.ghq-sector/agent-skills-report.md",
        },
        byProvider: {
          agents: { linkedCount: 1 },
          claude: { linkedCount: 1 },
        },
      },
    }));
    const copyResources = vi.fn(async () => ["a", "b"]);
    const generateCodeWorkspace = vi.fn(
      async () => "/tmp/project/workspace/main.code-workspace",
    );

    vi.doMock("../src/config/load-config.js", () => ({ loadConfig }));
    vi.doMock("../src/config/machine-paths.js", () => ({
      resolveConfigForCurrentMachine: vi.fn(async () => resolvedConfig),
    }));
    vi.doMock("../src/workspace/sync-workspace.js", () => ({ syncWorkspace }));
    vi.doMock("../src/resources/copy-resources.js", () => ({ copyResources }));
    vi.doMock("../src/workspace/generate-code-workspace.js", () => ({
      generateCodeWorkspace,
    }));

    const { runSync } = await importFresh<
      typeof import("../src/commands/sync.js")
    >("../src/commands/sync.js");
    const result = await runSync("/tmp/project");

    expect(syncWorkspace).toHaveBeenCalledWith(resolvedConfig);
    expect(copyResources).toHaveBeenCalledWith(resolvedConfig, "/tmp/project");
    expect(generateCodeWorkspace).toHaveBeenCalledWith(resolvedConfig);
    expect(result).toEqual({
      configPath: "/tmp/project/ghq-sector.config.json",
      workspaceRoot: resolvedConfig.workspaceRoot,
      linkedCount: 2,
      skippedCount: 1,
      copiedResourcesCount: 2,
      codeWorkspacePath: "/tmp/project/workspace/main.code-workspace",
      agentSkills: {
        linkedCount: 2,
        duplicateCount: 1,
        warningCount: 2,
        reports: {
          json: "/tmp/project/workspace/.ghq-sector/agent-skills-report.json",
          markdown: "/tmp/project/workspace/.ghq-sector/agent-skills-report.md",
        },
        byProvider: {
          agents: { linkedCount: 1 },
          claude: { linkedCount: 1 },
        },
      },
    });
  });
});

describe("workspace operations", () => {
  it("syncWorkspace recreates category links and skips missing sources", async () => {
    vi.doUnmock("../src/workspace/sync-workspace.js");
    vi.doUnmock("../src/config/machine-paths.js");
    const root = await makeTempRoot();
    const config = createConfig(root);
    const sourcePath = path.join(config.ghqRoot, "github.com", "ts-76", "life");
    const stalePath = path.join(config.workspaceRoot, "projects", "life");

    await mkdir(sourcePath, { recursive: true });
    await mkdir(path.dirname(stalePath), { recursive: true });
    await writeFile(stalePath, "stale file", "utf8");

    const { syncWorkspace } = await importFresh<
      typeof import("../src/workspace/sync-workspace.js")
    >("../src/workspace/sync-workspace.js");

    const result = await syncWorkspace(config);
    const linkTarget = await readFile(stalePath, "utf8").catch(() => null);

    expect(result.workspaceRoot).toBe(config.workspaceRoot);
    expect(result.linked).toContain(stalePath);
    expect(result.skipped).toContain(
      path.join(config.ghqRoot, "github.com", "ts-76", "dotfiles"),
    );
    expect(linkTarget).toBeNull();
  });

  it("copyConfigToWorkspace preserves file name and serialized content", async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const sourceConfigPath = path.join(root, "ghq-sector.config.yaml");

    await writeFile(sourceConfigPath, "ghqRoot: /tmp\n", "utf8");

    const { copyConfigToWorkspace } = await importFresh<
      typeof import("../src/config/copy-config-to-workspace.js")
    >("../src/config/copy-config-to-workspace.js");

    const destinationPath = await copyConfigToWorkspace(
      sourceConfigPath,
      config,
    );
    const copied = await readFile(destinationPath, "utf8");

    expect(destinationPath).toBe(
      path.join(config.workspaceRoot, "ghq-sector.config.yaml"),
    );
    expect(copied).toContain(`ghqRoot: ${config.ghqRoot}`);
    expect(copied).toContain(`workspaceRoot: ${config.workspaceRoot}`);
  });

  it("doctor warns when config ghqRoot differs from detected root", async () => {
    const root = await makeTempRoot();
    const config = {
      ...createConfig(root),
      ghqRoot: "/configured/ghq",
      workspaceRoot: path.join(root, "workspace"),
      repos: [],
      resources: [],
    } satisfies GhqWsConfig;
    const configPath = path.join(root, "ghq-sector.config.json");

    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    await mkdir(config.workspaceRoot, { recursive: true });

    vi.doMock("../src/shared/ghq.js", () => ({
      hasGhq: vi.fn(async () => true),
      getGhqRoot: vi.fn(async () => "/detected/ghq"),
    }));
    vi.doMock("../src/shared/gh.js", () => ({
      hasGh: vi.fn(async () => true),
      listGhOwnerCandidates: vi.fn(async () => []),
    }));

    const { runDoctor } = await importFresh<
      typeof import("../src/commands/doctor.js")
    >("../src/commands/doctor.js");

    const result = await runDoctor(configPath);

    expect(result.ghqRoot).toBe("/detected/ghq");
    expect(
      result.checks.some(
        (check) =>
          check.scope === "config ghqRoot" &&
          check.level === "warn" &&
          check.message.includes(
            "configured /configured/ghq, runtime /detected/ghq",
          ),
      ),
    ).toBe(true);
  });
});
