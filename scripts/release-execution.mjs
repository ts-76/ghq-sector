import assert from "node:assert/strict";

async function existingRelease(
  github,
  tagName,
  verifiedSha,
  requireMatch = false,
) {
  let tagSha;
  for await (const tag of github.tagIterator()) {
    if (tag.name === tagName) {
      tagSha = tag.sha;
      break;
    }
  }
  if (!tagSha) return null;
  if (tagSha !== verifiedSha) {
    assert.ok(!requireMatch, "Existing tag differs from verified commit");
    return null;
  }
  for await (const release of github.releaseIterator()) {
    if (release.tagName === tagName) {
      assert.ok(!release.draft, "Draft releases cannot be published");
      const { owner, repo } = github.repository;
      const { data } = await github
        .getGitHubApi()
        .octokit.repos.getReleaseByTag({ owner, repo, tag: tagName });
      assert.equal(data.tag_name, tagName);
      assert.ok(
        data.draft === false && data.prerelease === false,
        "Only public stable releases can be published",
      );
      assert.equal(
        release.sha,
        verifiedSha,
        "Release SHA differs from verified tag",
      );
      return { ...release, sha: verifiedSha, path: "." };
    }
  }
  return null;
}

// Only public Release Please APIs are used. Candidate objects are built once;
// creation never performs a second query against a possibly newer main.
export async function executeVerifiedRelease({
  github,
  manifest,
  verifiedSha,
  version,
  warn = console.warn,
}) {
  assert.match(verifiedSha ?? "", /^[a-f0-9]{40}$/, "GITHUB_SHA is required");
  assert.match(
    version,
    /^\d+\.\d+\.\d+$/,
    "Only stable versions are publishable",
  );
  const candidates = await manifest.buildReleases();
  assert.ok(candidates.length <= 1, "Expected a single root package release");
  if (candidates.length === 0) {
    // A previous attempt may have created the release and changed PR labels.
    // Only a tag/release on this exact verified commit can resume publication.
    const recovered = await existingRelease(github, `v${version}`, verifiedSha);
    return recovered ? { ...recovered, version } : null;
  }
  const candidate = candidates[0];
  assert.equal(candidate.path, ".");
  assert.equal(
    candidate.sha,
    verifiedSha,
    "Candidate was not verified by this run",
  );
  const tagName = candidate.tag.toString();
  const candidateVersion = candidate.tag.version.toString();
  assert.equal(tagName, `v${candidateVersion}`);
  assert.equal(
    candidateVersion,
    version,
    "Candidate version differs from checked-out package",
  );
  assert.ok(!candidate.forceTag, "Moving existing tags is prohibited");
  assert.ok(
    !candidate.draft && !candidate.prerelease,
    "Only stable releases are publishable",
  );
  let release = await existingRelease(github, tagName, verifiedSha, true);
  if (!release) {
    try {
      await github.createRelease(candidate, {
        draft: false,
        prerelease: false,
        forceTag: false,
      });
    } catch (error) {
      // A timeout may occur after GitHub persisted the release.
      release = await existingRelease(github, tagName, verifiedSha, true);
      if (!release) throw error;
    }
  }
  release ??= await existingRelease(github, tagName, verifiedSha, true);
  assert.ok(release, "Created release/tag could not be verified");
  assert.equal(
    release.sha,
    verifiedSha,
    "Created release SHA differs from verified commit",
  );
  assert.equal(release.tagName, tagName);
  // Follow-up metadata must not lose the already-created release outputs.
  try {
    await github.addIssueLabels(
      manifest.releaseLabels,
      candidate.pullRequest.number,
    );
    await github.commentOnIssue(
      `Release ready: [${tagName}](${release.url})`,
      candidate.pullRequest.number,
    );
    await github.removeIssueLabels(
      manifest.labels,
      candidate.pullRequest.number,
    );
  } catch {
    warn(
      "Release metadata update failed; retry to reconcile labels/comments. Verified release remains resumable.",
    );
  }
  return { ...release, path: ".", version: candidateVersion };
}
