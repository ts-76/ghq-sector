import { describe, expect, it, vi } from "vitest";
import { executeVerifiedRelease } from "../scripts/release-execution.mjs";

const sha = "a".repeat(40);
const other = "b".repeat(40);
const tagName = "v1.3.1";
async function* entries(values) {
  yield* values;
}
function fixture({
  candidateSha = sha,
  noCandidate = false,
  tags = [],
  releases = [],
} = {}) {
  const release = { sha, tagName, url: "https://example.test/release" };
  const candidate = {
    path: ".",
    sha: candidateSha,
    tag: { toString: () => tagName, version: { toString: () => "1.3.1" } },
    pullRequest: { number: 48 },
  };
  const github = {
    repository: { owner: "ts-76", repo: "ghq-sector" },
    getGitHubApi: () => ({
      octokit: {
        repos: {
          getReleaseByTag: async () => ({
            data: {
              tag_name: tagName,
              draft: false,
              prerelease: false,
              ...releases.find((r) => r.tagName === tagName),
            },
          }),
        },
      },
    }),
    tagIterator: vi.fn(() => entries(tags)),
    releaseIterator: vi.fn(() => entries(releases)),
    createRelease: vi.fn(async () => {
      tags.push({ name: tagName, sha });
      releases.push(release);
      return release;
    }),
    addIssueLabels: vi.fn(async () => {}),
    commentOnIssue: vi.fn(async () => {}),
    removeIssueLabels: vi.fn(async () => {}),
  };
  const manifest = {
    buildReleases: vi.fn(async () => (noCandidate ? [] : [candidate])),
    labels: ["autorelease: pending"],
    releaseLabels: ["autorelease: tagged"],
  };
  return {
    github,
    manifest,
    verifiedSha: sha,
    version: "1.3.1",
    warn: vi.fn(),
    release,
  };
}
describe("verified release execution", () => {
  it("rejects a newer main candidate before any write", async () => {
    const f = fixture({ candidateSha: other });
    await expect(executeVerifiedRelease(f)).rejects.toThrow("not verified");
    expect(f.github.createRelease).not.toHaveBeenCalled();
    expect(f.github.addIssueLabels).not.toHaveBeenCalled();
  });
  it("makes no writes when there is no candidate", async () => {
    const f = fixture({ noCandidate: true });
    expect(await executeVerifiedRelease(f)).toBeNull();
    expect(f.github.createRelease).not.toHaveBeenCalled();
    expect(f.github.commentOnIssue).not.toHaveBeenCalled();
  });
  it("builds candidates once and creates only that verified SHA", async () => {
    const f = fixture();
    expect(await executeVerifiedRelease(f)).toMatchObject({
      sha,
      tagName,
      version: "1.3.1",
    });
    expect(f.manifest.buildReleases).toHaveBeenCalledTimes(1);
    expect(f.github.createRelease.mock.calls[0][0].sha).toBe(sha);
  });
  it("keeps outputs when comment or label updates fail", async () => {
    for (const method of [
      "commentOnIssue",
      "addIssueLabels",
      "removeIssueLabels",
    ]) {
      const f = fixture();
      f.github[method].mockRejectedValueOnce(new Error("metadata denied"));
      expect(await executeVerifiedRelease(f)).toMatchObject({ sha, tagName });
      expect(f.warn).toHaveBeenCalledOnce();
    }
  });
  it("resumes an existing candidate release without creating it twice", async () => {
    const f = fixture({
      tags: [{ name: tagName, sha }],
      releases: [{ sha, tagName, url: "https://example.test/release" }],
    });
    expect(await executeVerifiedRelease(f)).toMatchObject({ sha, tagName });
    expect(f.github.createRelease).not.toHaveBeenCalled();
  });
  it("resumes after labels were updated and no candidate remains, with no writes", async () => {
    const f = fixture({
      noCandidate: true,
      tags: [{ name: tagName, sha }],
      releases: [{ sha, tagName }],
    });
    expect(await executeVerifiedRelease(f)).toMatchObject({ sha, tagName });
    expect(f.github.createRelease).not.toHaveBeenCalled();
    expect(f.github.addIssueLabels).not.toHaveBeenCalled();
  });
  it("does not resume a different tag commit even when target_commitish looks correct", async () => {
    const f = fixture({
      noCandidate: true,
      tags: [{ name: tagName, sha: other }],
      releases: [{ sha, tagName }],
    });
    expect(await executeVerifiedRelease(f)).toBeNull();
  });
  it("rejects a conflicting existing tag before any create attempt", async () => {
    const f = fixture({ tags: [{ name: tagName, sha: other }] });
    await expect(executeVerifiedRelease(f)).rejects.toThrow(
      "Existing tag differs",
    );
    expect(f.github.createRelease).not.toHaveBeenCalled();
  });
  it("recovers a create timeout after the release was actually persisted", async () => {
    const f = fixture();
    f.github.createRelease.mockImplementationOnce(async () => {
      f.github.tagIterator.mockImplementation(() =>
        entries([{ name: tagName, sha }]),
      );
      f.github.releaseIterator.mockImplementation(() => entries([f.release]));
      throw new Error("request timed out");
    });
    expect(await executeVerifiedRelease(f)).toMatchObject({ sha, tagName });
  });
  it("rejects a successful response when the persisted tag has another SHA", async () => {
    const f = fixture();
    f.github.createRelease.mockImplementationOnce(async () => {
      f.github.tagIterator.mockImplementation(() =>
        entries([{ name: tagName, sha: other }]),
      );
      f.github.releaseIterator.mockImplementation(() => entries([f.release]));
      return f.release;
    });
    await expect(executeVerifiedRelease(f)).rejects.toThrow(
      "Existing tag differs",
    );
    expect(f.github.commentOnIssue).not.toHaveBeenCalled();
  });
  it("rejects existing draft releases on candidate and no-candidate retries", async () => {
    for (const noCandidate of [false, true]) {
      const f = fixture({
        noCandidate,
        tags: [{ name: tagName, sha }],
        releases: [{ sha, tagName, draft: true }],
      });
      await expect(executeVerifiedRelease(f)).rejects.toThrow("Draft releases");
      expect(f.github.createRelease).not.toHaveBeenCalled();
    }
  });
  it("rejects a stable tag marked as a GitHub prerelease", async () => {
    const f = fixture({
      noCandidate: true,
      tags: [{ name: tagName, sha }],
      releases: [{ sha, tagName, prerelease: true }],
    });
    await expect(executeVerifiedRelease(f)).rejects.toThrow(
      "Only public stable",
    );
    expect(f.github.createRelease).not.toHaveBeenCalled();
  });
  it("rejects a prerelease version even if a candidate flag is missing", async () => {
    const f = fixture();
    f.version = "1.3.1-rc.1";
    await expect(executeVerifiedRelease(f)).rejects.toThrow("stable versions");
    expect(f.github.createRelease).not.toHaveBeenCalled();
  });
  it("fails closed if creation failed without a matching persisted release", async () => {
    const f = fixture();
    f.github.createRelease.mockRejectedValueOnce(new Error("denied"));
    await expect(executeVerifiedRelease(f)).rejects.toThrow("denied");
    expect(f.github.commentOnIssue).not.toHaveBeenCalled();
  });
});
