import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncWorkspace } from "../src/workspace/sync-workspace.js";
import { createConfig, importFresh, makeTempRoot } from "./helpers.js";

async function fixture() {
  const root = await makeTempRoot();
  const config = createConfig(root);
  config.repos = config.repos.slice(0, 1);
  const sourcePath = path.join(config.ghqRoot, "github.com", "ts-76", "life");
  const destinationPath = path.join(config.workspaceRoot, "projects", "life");
  await mkdir(sourcePath, { recursive: true });
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await symlink(sourcePath, destinationPath);
  return { root, config, sourcePath, destinationPath };
}

describe("ownership manifest consistency", () => {
  it("retains A ownership while desired B is missing and updates safely once B appears", async () => {
    const { config, sourcePath, destinationPath } = await fixture();
    await writeFile(path.join(sourcePath, "keep.txt"), "original source");
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
    const manifest = path.join(
      config.workspaceRoot,
      ".ghq-sector",
      "repo-links-manifest.json",
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      await syncWorkspace(config);
      expect(await readlink(destinationPath)).toBe(sourcePath);
      expect(JSON.parse(await readFile(manifest, "utf8")).links).toEqual([
        { destinationPath, sourcePath },
      ]);
    }
    await mkdir(nextSource, { recursive: true });
    await syncWorkspace(config);
    expect(await readlink(destinationPath)).toBe(nextSource);
    expect(JSON.parse(await readFile(manifest, "utf8")).links).toEqual([
      { destinationPath, sourcePath: nextSource },
    ]);
    expect(await readFile(path.join(sourcePath, "keep.txt"), "utf8")).toBe(
      "original source",
    );
  });

  it("does not grant ownership to missing destinations", async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    await syncWorkspace(config);
    const manifest = path.join(
      config.workspaceRoot,
      ".ghq-sector",
      "repo-links-manifest.json",
    );
    expect(JSON.parse(await readFile(manifest, "utf8")).links).toEqual([]);
  });
});

describe("case detection on the workspace volume", () => {
  it.each([false, true])(
    "probes a child on the target volume (caseInsensitive=%s), not its parent",
    async (caseInsensitive) => {
      const root = await makeTempRoot();
      const workspace = path.join(root, "mounted-workspace");
      await mkdir(workspace);
      let probe = "";
      const requests: string[] = [];
      vi.doMock("node:fs/promises", async () => {
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        return {
          ...actual,
          mkdtemp: vi.fn(async (prefix: string) => {
            expect(path.dirname(prefix)).toBe(workspace);
            probe = await actual.mkdtemp(prefix);
            return probe;
          }),
          lstat: vi.fn(async (filename: string) => {
            requests.push(filename);
            if (
              probe &&
              filename ===
                path.join(workspace, path.basename(probe).toUpperCase())
            ) {
              if (caseInsensitive) return actual.lstat(probe);
              throw Object.assign(new Error("not found"), { code: "ENOENT" });
            }
            return actual.lstat(filename);
          }),
        };
      });
      const { usesCaseInsensitivePaths } = await importFresh<
        typeof import("../src/workspace/safe-links.js")
      >("../src/workspace/safe-links.js");
      expect(await usesCaseInsensitivePaths(workspace)).toBe(caseInsensitive);
      expect(probe).not.toBe("");
      expect(
        requests.every(
          (entry) => entry === workspace || path.dirname(entry) === workspace,
        ),
      ).toBe(true);
      expect(await readdir(workspace)).toEqual([]);
    },
  );

  it("cleans the probe when inspection fails", async () => {
    const root = await makeTempRoot();
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        lstat: vi.fn(async (filename: string) => {
          if (path.basename(filename).startsWith(".GHQ-SECTOR-CASE-"))
            throw Object.assign(new Error("probe denied"), { code: "EACCES" });
          return actual.lstat(filename);
        }),
      };
    });
    const { usesCaseInsensitivePaths } = await importFresh<
      typeof import("../src/workspace/safe-links.js")
    >("../src/workspace/safe-links.js");
    await expect(usesCaseInsensitivePaths(root)).rejects.toThrow(
      "probe denied",
    );
    expect(await readdir(root)).toEqual([]);
  });
});

describe("entry replacement races", () => {
  it.each(["update", "manifest"])(
    "does not trust a symlink target swapped during %s validation",
    async (operation) => {
      const { root, config, sourcePath, destinationPath } = await fixture();
      const nextSource = path.join(root, "next-source");
      const foreignSource = path.join(root, "foreign-source");
      await mkdir(nextSource);
      await mkdir(foreignSource);
      let reads = 0;
      vi.doMock("node:fs/promises", async () => {
        const actual =
          await vi.importActual<typeof import("node:fs/promises")>(
            "node:fs/promises",
          );
        return {
          ...actual,
          readlink: vi.fn(async (filename: string) => {
            if (
              filename === destinationPath &&
              ++reads === (operation === "update" ? 3 : 2)
            ) {
              await actual.unlink(destinationPath);
              await actual.symlink(foreignSource, destinationPath);
            }
            return actual.readlink(filename);
          }),
        };
      });
      const { installLink, observedOwnedLinks } = await importFresh<
        typeof import("../src/workspace/safe-links.js")
      >("../src/workspace/safe-links.js");
      const desired = { sourcePath: nextSource, destinationPath };
      const previous = [{ sourcePath, destinationPath }];
      const result =
        operation === "update"
          ? installLink(config.workspaceRoot, desired, previous)
          : observedOwnedLinks(config.workspaceRoot, [desired], previous);
      await expect(result).rejects.toThrow(
        "unexpected symlink target is preserved",
      );
      expect(await readlink(destinationPath)).toBe(foreignSource);
      expect(
        (await readdir(path.dirname(destinationPath))).some((name) =>
          name.startsWith(".ghq-sector-retired-"),
        ),
      ).toBe(false);
    },
  );
  it.each([
    "update file",
    "update directory",
    "cleanup file",
    "cleanup directory",
    "update concurrent file",
    "cleanup concurrent file",
  ])("preserves data during %s", async (scenario) => {
    const { root, config, sourcePath, destinationPath } = await fixture();
    const nextSource = path.join(root, "next-source");
    await mkdir(nextSource);
    let retained = "";
    let raced = false;
    vi.doMock("node:fs/promises", async () => {
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      return {
        ...actual,
        rename: vi.fn(async (from: string, to: string) => {
          if (from === destinationPath && !raced) {
            raced = true;
            await actual.unlink(from);
            if (scenario.endsWith("directory")) {
              await actual.mkdir(from);
              await actual.writeFile(
                path.join(from, "keep.txt"),
                "raced directory",
              );
            } else await actual.writeFile(from, "raced file");
            await actual.rename(from, to);
            retained = to;
            if (scenario.includes("concurrent"))
              await actual.writeFile(from, "new concurrent file");
            return;
          }
          return actual.rename(from, to);
        }),
      };
    });
    const { installLink, removeRecordedLink } = await importFresh<
      typeof import("../src/workspace/safe-links.js")
    >("../src/workspace/safe-links.js");
    const link = { sourcePath, destinationPath };
    const result = scenario.startsWith("update")
      ? installLink(config.workspaceRoot, { ...link, sourcePath: nextSource }, [
          link,
        ])
      : removeRecordedLink(config.workspaceRoot, link);
    await expect(result).rejects.toThrow(
      "entry changed during sync and was preserved at",
    );
    expect(raced).toBe(true);
    if (scenario.endsWith("directory")) {
      expect((await lstat(retained)).isDirectory()).toBe(true);
      expect(await readFile(path.join(retained, "keep.txt"), "utf8")).toBe(
        "raced directory",
      );
      expect(
        await readFile(path.join(destinationPath, "keep.txt"), "utf8"),
      ).toBe("raced directory");
    } else {
      expect(await readFile(retained, "utf8")).toBe("raced file");
      expect(await readFile(destinationPath, "utf8")).toBe(
        scenario.includes("concurrent") ? "new concurrent file" : "raced file",
      );
    }
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
  });

  it("retains replaced/stale links for recovery and never removes their targets", async () => {
    const { root, config, sourcePath, destinationPath } = await fixture();
    const { installLink, removeRecordedLink } = await importFresh<
      typeof import("../src/workspace/safe-links.js")
    >("../src/workspace/safe-links.js");
    const nextSource = path.join(root, "next-source");
    await mkdir(nextSource);
    await installLink(
      config.workspaceRoot,
      { sourcePath: nextSource, destinationPath },
      [{ sourcePath, destinationPath }],
    );
    expect(await readlink(destinationPath)).toBe(nextSource);
    expect(
      await removeRecordedLink(config.workspaceRoot, {
        sourcePath: nextSource,
        destinationPath,
      }),
    ).toBe(true);
    const backups = (await readdir(path.dirname(destinationPath))).filter(
      (name) => name.startsWith(".ghq-sector-retired-"),
    );
    expect(backups).toHaveLength(2);
    const targets = await Promise.all(
      backups.map((name) =>
        readlink(path.join(path.dirname(destinationPath), name, "entry")),
      ),
    );
    expect(targets.sort()).toEqual([sourcePath, nextSource].sort());
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect((await lstat(nextSource)).isDirectory()).toBe(true);
  });
});

describe("exclusive workspace sync lease", () => {
  it("refuses a second concurrent sync and releases the lease after completion or failure", async () => {
    const { config } = await fixture();
    const { withWorkspaceSyncLease } = await importFresh<
      typeof import("../src/workspace/safe-links.js")
    >("../src/workspace/safe-links.js");
    await withWorkspaceSyncLease(config.workspaceRoot, async () => {
      await expect(syncWorkspace(config)).rejects.toThrow(
        "another sync holds the workspace lease",
      );
    });
    await expect(
      withWorkspaceSyncLease(config.workspaceRoot, async () => {
        throw new Error("fixture failure");
      }),
    ).rejects.toThrow("fixture failure");
    expect(
      await lstat(
        path.join(config.workspaceRoot, ".ghq-sector-sync.lock"),
      ).catch(() => null),
    ).toBeNull();
    await syncWorkspace(config);
  });

  it("does not steal or recursively remove an existing/nonempty lease", async () => {
    const { config } = await fixture();
    const lease = path.join(config.workspaceRoot, ".ghq-sector-sync.lock");
    await mkdir(lease);
    await writeFile(path.join(lease, "keep.txt"), "user contents");
    await expect(syncWorkspace(config)).rejects.toThrow(
      "another sync holds the workspace lease",
    );
    expect(await readFile(path.join(lease, "keep.txt"), "utf8")).toBe(
      "user contents",
    );
  });
});
