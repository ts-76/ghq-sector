import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import "release-please";
import { parseConventionalCommits } from "release-please/build/src/commit.js";
import { buildStrategy } from "release-please/build/src/factory.js";
import type { Scm } from "release-please/build/src/scm.js";
import { TagName } from "release-please/build/src/util/tag-name.js";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));

describe("release migration", () => {
  it("rejects tag creation even inside the main Actions environment", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-control.mjs", "release"],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GITHUB_ACTIONS: "true",
          GITHUB_REPOSITORY: "ts-76/ghq-sector",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: "a".repeat(40),
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Tag creation and publication are disabled",
    );
  });

  it("only maintains release PRs after verification, without OIDC or publishing jobs", async () => {
    const workflow = YAML.parse(
      await readFile(".github/workflows/release.yml", "utf8"),
    );
    expect(Object.keys(workflow.jobs).sort()).toEqual(["release-pr", "verify"]);
    expect(workflow.jobs["release-pr"].needs).toBe("verify");
    expect(workflow.jobs["release-pr"].if).toBe(
      "github.ref == 'refs/heads/main'",
    );
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs) as {
      permissions?: Record<string, string>;
    }[]) {
      expect(job.permissions?.["id-token"]).toBeUndefined();
    }
    expect(workflow.jobs["release-pr"].steps.at(-1).run).toBe(
      "node scripts/release-control.mjs pr",
    );
  });

  it("continues the existing version and updates both npm version records", async () => {
    const config = await readJson("release-please-config.json");
    const manifest = await readJson(".release-please-manifest.json");
    const packageJson = await readJson("package.json");
    expect(packageJson.version).toBe(manifest["."]);
    const root = config.packages["."];
    expect(root["release-type"]).toBe("node");
    const github = {
      repository: { owner: "ts-76", repo: "ghq-sector", defaultBranch: "main" },
      getFileContentsOnBranch: async (path: string) => ({
        parsedContent: await readFile(path, "utf8"),
      }),
    } as unknown as Scm;
    const strategy = await buildStrategy({
      releaseType: "node",
      github,
      targetBranch: "main",
      packageName: root["package-name"],
      includeComponentInTag: root["include-component-in-tag"],
      includeVInTag: root["include-v-in-tag"],
    });
    const latestTag = TagName.parse(`v${manifest["."]}`);
    if (!latestTag) throw new Error("Invalid release baseline");
    const candidate = await strategy.buildReleasePullRequest(
      parseConventionalCommits([
        {
          sha: "a".repeat(40),
          message: "fix: refresh dependencies",
          files: ["package.json"],
        },
      ]),
      { tag: latestTag, sha: config["bootstrap-sha"], notes: "" },
    );
    expect(candidate).toBeDefined();
    const version = candidate?.version?.toString();
    expect(version).toBe(
      `${latestTag.version.major}.${latestTag.version.minor}.${latestTag.version.patch + 1}`,
    );
    const updates = new Map(
      candidate?.updates.map((update) => [update.path, update]),
    );
    for (const path of ["package.json", "package-lock.json"]) {
      const update = updates.get(path);
      if (!update) throw new Error(`Missing ${path} release update`);
      const updated = JSON.parse(
        update.updater.updateContent(await readFile(path, "utf8")),
      );
      expect(updated.version).toBe(version);
      if (path === "package-lock.json") {
        expect(updated.packages[""].version).toBe(version);
      }
    }
    expect(updates.has("CHANGELOG.md")).toBe(true);
    expect(candidate?.body.toString()).toContain(`v${version}`);
    // Bun's root lock has no version field, so version-only PRs keep it valid.
    const bunLock = await readFile("bun.lock", "utf8");
    expect(bunLock).not.toContain('"version":');
  });
});
