import { spawnSync } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planAgentSkills } from "../src/workspace/agent-skills.js";
import { usesCaseInsensitivePaths } from "../src/workspace/safe-links.js";
import { syncAgentSkills } from "../src/workspace/sync-agent-skills.js";
import { syncWorkspace } from "../src/workspace/sync-workspace.js";
import { createConfig, makeTempRoot } from "./helpers.js";

async function fixture() {
  const root = await makeTempRoot();
  const config = createConfig(root);
  config.repos = config.repos.slice(0, 1);
  const source = path.join(config.ghqRoot, "github.com", "ts-76", "life");
  const destination = path.join(config.workspaceRoot, "projects", "life");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "keep.txt"), "source contents");
  await mkdir(path.dirname(destination), { recursive: true });
  return { root, config, source, destination };
}

describe("workspace destination protection", () => {
  it("rejects case aliases before linking on case-insensitive volumes", async () => {
    const { config, destination } = await fixture();
    if (!(await usesCaseInsensitivePaths(config.workspaceRoot))) return;
    const first = config.repos[0];
    if (!first) throw new Error("expected fixture repo");
    config.repos.push({
      ...first,
      owner: "another",
      name: "LIFE",
      category: "PROJECTS",
    });
    await expect(syncWorkspace(config)).rejects.toThrow(
      "duplicate or overlapping",
    );
    expect(await lstat(destination).catch(() => null)).toBeNull();
  });
  it.each([
    "file",
    "empty directory",
    "nonempty directory",
  ])("preserves an existing %s and rejects the entire plan", async (kind) => {
    const { root, config, destination } = await fixture();
    if (kind === "file") await writeFile(destination, "user contents");
    else {
      await mkdir(destination);
      if (kind === "nonempty directory")
        await writeFile(path.join(destination, "keep.txt"), "user contents");
    }
    config.repos.unshift({
      provider: "github.com",
      owner: "ts-76",
      name: "other",
      category: "projects",
    });
    await mkdir(path.join(config.ghqRoot, "github.com", "ts-76", "other"));
    await expect(syncWorkspace(config)).rejects.toThrow(
      `${destination}: existing ${kind === "file" ? "file" : "directory"} is preserved`,
    );
    expect(
      await lstat(path.join(config.workspaceRoot, "projects", "other")).catch(
        () => null,
      ),
    ).toBeNull();
    if (kind !== "empty directory")
      expect(
        await readFile(
          kind === "file" ? destination : path.join(destination, "keep.txt"),
          "utf8",
        ),
      ).toBe("user contents");
    expect((await lstat(root)).isDirectory()).toBe(true);
  });

  it("keeps expected links, recreates removed links, updates recorded links, and preserves their targets", async () => {
    const { config, source, destination } = await fixture();
    await symlink(source, destination);
    await syncWorkspace(config);
    await syncWorkspace(config);
    expect(await readlink(destination)).toBe(source);
    await rm(destination);
    await syncWorkspace(config);
    const repo = config.repos[0];
    if (!repo) throw new Error("expected fixture repo");
    repo.owner = "new-owner";
    const nextSource = path.join(
      config.ghqRoot,
      "github.com",
      "new-owner",
      "life",
    );
    await mkdir(nextSource, { recursive: true });
    await syncWorkspace(config);
    expect(await readlink(destination)).toBe(nextSource);
    expect(await readFile(path.join(source, "keep.txt"), "utf8")).toBe(
      "source contents",
    );
  });

  it("preserves a broken expected link until its source becomes available", async () => {
    const { config, source, destination } = await fixture();
    await rm(source, { recursive: true });
    await symlink(source, destination);
    expect((await syncWorkspace(config)).skipped).toContain(source);
    expect(await readlink(destination)).toBe(source);
    await mkdir(source);
    await syncWorkspace(config);
    expect(await readlink(destination)).toBe(source);
  });

  it.each([
    false,
    true,
  ])("preserves an unexpected symlink (broken=%s)", async (broken) => {
    const { root, config, destination } = await fixture();
    const other = path.join(root, "other");
    if (!broken) await mkdir(other);
    await symlink(other, destination);
    await expect(syncWorkspace(config)).rejects.toThrow(
      "unexpected symlink target is preserved",
    );
    expect(await readlink(destination)).toBe(other);
  });

  it.each([
    "escape",
    "duplicate",
    "parent link",
    "overlap",
  ])("rejects %s before creating another link", async (kind) => {
    const { root, config, destination } = await fixture();
    const original = config.repos[0];
    if (!original) throw new Error("expected fixture repo");
    const repo = { ...original };
    if (kind === "escape") repo.category = "../../outside";
    if (kind === "duplicate") repo.owner = "another";
    if (kind === "overlap") repo.name = "life/nested";
    if (kind === "parent link") {
      repo.category = "alias";
      const outside = path.join(root, "outside");
      await mkdir(outside);
      await symlink(outside, path.join(config.workspaceRoot, "alias"));
    }
    config.repos.push(repo);
    await expect(syncWorkspace(config)).rejects.toThrow(
      /inside workspace root|duplicate or overlapping|symlink parent/,
    );
    expect(await lstat(destination).catch(() => null)).toBeNull();
    expect(
      await lstat(path.join(root, "outside", "life")).catch(() => null),
    ).toBeNull();
  });
});

async function skillsFixture() {
  const entry = await fixture();
  entry.config.agentSkills = { enabled: true, providers: ["agents"] };
  const sourcePath = path.join(entry.source, ".agents", "skills", "example");
  await mkdir(sourcePath, { recursive: true });
  await writeFile(
    path.join(sourcePath, "SKILL.md"),
    "---\nname: Example\n---\nKeep source\n",
  );
  const plan = await planAgentSkills(entry.config);
  const skill = plan.selected[0];
  if (!skill) throw new Error("expected fixture skill");
  const destinationPath = skill.destinationPath;
  await mkdir(path.dirname(destinationPath), { recursive: true });
  return { ...entry, plan, sourcePath, destinationPath };
}

describe("skill destination protection", () => {
  it("does not allow stale cleanup to unlink a current repo destination", async () => {
    const { config, source } = await skillsFixture();
    const manifest = path.join(
      config.workspaceRoot,
      ".ghq-sector",
      "agent-skills-manifest.json",
    );
    await mkdir(path.dirname(manifest));
    const first = config.repos[0];
    if (!first) throw new Error("expected fixture repo");
    config.repos = [{ ...first, category: ".agents/skills" }];
    config.agentSkills = { enabled: true, providers: ["claude"] };
    const currentDestination = path.join(
      config.workspaceRoot,
      ".agents",
      "skills",
      "life",
    );
    await symlink(source, currentDestination);
    await writeFile(
      manifest,
      JSON.stringify({
        version: 1,
        links: [{ destinationPath: currentDestination, sourcePath: source }],
      }),
    );
    await expect(syncWorkspace(config)).rejects.toThrow(
      "duplicate or overlapping",
    );
    expect(await readlink(currentDestination)).toBe(source);
  });

  it("rejects duplicate skill destinations and paths outside the root before repo linking", async () => {
    const { config, plan, destination, root } = await skillsFixture();
    const skill = plan.selected[0];
    if (!skill) throw new Error("expected fixture skill");
    await expect(
      syncAgentSkills(config.workspaceRoot, {
        ...plan,
        selected: [skill, { ...skill }],
      }),
    ).rejects.toThrow("duplicate or overlapping");
    await expect(
      syncAgentSkills(config.workspaceRoot, {
        ...plan,
        selected: [{ ...skill, destinationPath: path.join(root, "escape") }],
      }),
    ).rejects.toThrow("inside workspace root");
    expect(await lstat(destination).catch(() => null)).toBeNull();
  });

  it("protects metadata leaf symlinks and report directories when skills are disabled", async () => {
    const { root, config } = await fixture();
    const metadata = path.join(config.workspaceRoot, ".ghq-sector");
    await mkdir(metadata);
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "user contents");
    const report = path.join(metadata, "agent-skills-report.json");
    await symlink(outside, report);
    await expect(syncWorkspace(config)).rejects.toThrow(
      "metadata must be an actual file",
    );
    expect(await readFile(outside, "utf8")).toBe("user contents");
    await rm(report);
    await mkdir(report);
    await expect(syncWorkspace(config)).rejects.toThrow(
      "metadata must be an actual file",
    );
    expect((await lstat(report)).isDirectory()).toBe(true);
  });

  it("rejects a repo link occupying generated metadata or a required category", async () => {
    const { config, destination } = await fixture();
    config.repos.push({
      provider: "github.com",
      owner: "missing",
      category: ".ghq-sector",
      name: "agent-skills-report.json",
    });
    await expect(syncWorkspace(config)).rejects.toThrow(
      "duplicate or overlapping",
    );
    config.repos.pop();
    config.categories.push("projects/life/nested");
    await expect(syncWorkspace(config)).rejects.toThrow(
      "link overlaps a required directory",
    );
    expect(await lstat(destination).catch(() => null)).toBeNull();
  });

  it.each([
    "file",
    "directory",
    "unexpected link",
  ])("preserves a selected skill %s and prevents repo changes", async (kind) => {
    const { root, config, sourcePath, destinationPath, destination } =
      await skillsFixture();
    if (kind === "file") await writeFile(destinationPath, "user contents");
    if (kind === "directory") await mkdir(destinationPath);
    if (kind === "unexpected link")
      await symlink(path.join(root, "missing"), destinationPath);
    await expect(syncWorkspace(config)).rejects.toThrow(
      /existing|unexpected symlink/,
    );
    expect(await lstat(destination).catch(() => null)).toBeNull();
    expect(await readFile(path.join(sourcePath, "SKILL.md"), "utf8")).toContain(
      "Keep source",
    );
  });

  it("updates recorded skills and removes only stale links whose recorded targets still match", async () => {
    const { config, plan, sourcePath, destinationPath, root } =
      await skillsFixture();
    await syncAgentSkills(config.workspaceRoot, plan);
    const nextSource = path.join(root, "next-skill");
    await mkdir(nextSource);
    const skill = plan.selected[0];
    if (!skill) throw new Error("expected fixture skill");
    skill.sourcePath = nextSource;
    await syncAgentSkills(config.workspaceRoot, plan);
    expect(await readlink(destinationPath)).toBe(nextSource);
    const stalePlan = { ...plan, selected: [] };
    expect(
      (await syncAgentSkills(config.workspaceRoot, stalePlan)).removed,
    ).toEqual([destinationPath]);
    expect(await readFile(path.join(sourcePath, "SKILL.md"), "utf8")).toContain(
      "Keep source",
    );
    await syncAgentSkills(config.workspaceRoot, stalePlan);
    expect((await lstat(nextSource)).isDirectory()).toBe(true);
  });

  it.each([
    "legacy",
    "file",
    "directory",
    "different target",
    "outside",
  ])("does not delete stale %s entries based on a manifest alone", async (kind) => {
    const { config, plan, sourcePath, destinationPath, root } =
      await skillsFixture();
    const manifest = path.join(
      config.workspaceRoot,
      ".ghq-sector",
      "agent-skills-manifest.json",
    );
    await mkdir(path.dirname(manifest));
    const stalePath =
      kind === "outside" ? path.join(root, "outside.txt") : destinationPath;
    if (kind === "file" || kind === "outside")
      await writeFile(stalePath, "user contents");
    else if (kind === "directory") await mkdir(stalePath);
    else
      await symlink(
        kind === "different target" ? path.join(root, "missing") : sourcePath,
        stalePath,
      );
    await writeFile(
      manifest,
      JSON.stringify(
        kind === "legacy"
          ? [stalePath]
          : { version: 1, links: [{ destinationPath: stalePath, sourcePath }] },
      ),
    );
    expect(
      (await syncAgentSkills(config.workspaceRoot, { ...plan, selected: [] }))
        .removed,
    ).toEqual([]);
    expect(await lstat(stalePath)).toBeTruthy();
  });

  it("refuses stale and report paths under a parent symlink without changing outside files", async () => {
    const { config, plan, sourcePath, destinationPath, root } =
      await skillsFixture();
    await syncAgentSkills(config.workspaceRoot, plan);
    await rm(path.join(config.workspaceRoot, ".agents"), { recursive: true });
    const outside = path.join(root, "outside");
    await mkdir(path.join(outside, "skills"), { recursive: true });
    await symlink(
      sourcePath,
      path.join(outside, "skills", path.basename(destinationPath)),
    );
    await symlink(outside, path.join(config.workspaceRoot, ".agents"));
    await expect(
      syncAgentSkills(config.workspaceRoot, { ...plan, selected: [] }),
    ).rejects.toThrow("symlink parent");
    expect(
      await readlink(
        path.join(outside, "skills", path.basename(destinationPath)),
      ),
    ).toBe(sourcePath);
    await rm(path.join(config.workspaceRoot, ".ghq-sector"), {
      recursive: true,
    });
    await symlink(outside, path.join(config.workspaceRoot, ".ghq-sector"));
    await expect(syncWorkspace(config)).rejects.toThrow("symlink parent");
    expect(
      await lstat(path.join(outside, "repo-links-manifest.json")).catch(
        () => null,
      ),
    ).toBeNull();
  });
});

describe("isolated CLI sync/apply", () => {
  it.each([
    "sync",
    "apply",
  ])("%s preserves collisions and succeeds safely after the user moves them", async (command) => {
    const { root, config, destination, source } = await fixture();
    await writeFile(
      path.join(root, "ghq-sector.config.json"),
      JSON.stringify(config),
    );
    // Stub ghq root within the fixture so machine discovery cannot select user repos.
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await writeFile(
      path.join(bin, "ghq"),
      `#!/bin/sh\nif [ "$1" = root ]; then printf '%s\\n' '${config.ghqRoot}'; else exit 99; fi\n`,
      { mode: 0o755 },
    );
    const cliPath = path.resolve("src/cli/main.ts");
    const tsxPath = path.resolve("node_modules/tsx/dist/loader.mjs");
    const invoke = () =>
      spawnSync(process.execPath, ["--import", tsxPath, cliPath, command], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        },
        encoding: "utf8",
      });
    await writeFile(destination, "user contents");
    const failed = invoke();
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain(
      `${destination}: existing file is preserved`,
    );
    expect(await readFile(destination, "utf8")).toBe("user contents");
    await rm(destination);
    for (let count = 0; count < 2; count++) {
      const result = invoke();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(await readlink(destination)).toBe(source);
    }
    expect(await readFile(path.join(source, "keep.txt"), "utf8")).toBe(
      "source contents",
    );
  });
});
