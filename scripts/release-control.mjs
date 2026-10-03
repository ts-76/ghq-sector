import assert from "node:assert/strict";
import { GitHub, Manifest } from "release-please";

const mode = process.argv[2] || "preview";
assert.notEqual(mode, "release", "Tag creation and publication are disabled");
assert.ok(["preview", "pr"].includes(mode), "Unknown release mode");
const repository = process.env.GITHUB_REPOSITORY || "ts-76/ghq-sector";
const branch = process.env.RELEASE_TARGET_BRANCH || "main";
const [owner, repo] = repository.split("/");
if (mode !== "preview") {
  assert.equal(
    process.env.GITHUB_ACTIONS,
    "true",
    "Writes require GitHub Actions",
  );
  assert.equal(repository, "ts-76/ghq-sector");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.equal(branch, "main");
  assert.ok(process.env.GITHUB_TOKEN, "GITHUB_TOKEN is required");
}
const github = await GitHub.create({
  owner,
  repo,
  token: process.env.GITHUB_TOKEN,
  defaultBranch: branch,
});
const manifest = await Manifest.fromManifest(github, branch);
if (mode === "preview") {
  const prs = await manifest.buildPullRequests();
  const releases = await manifest.buildReleases();
  console.log(JSON.stringify({ prs, releases }, null, 2));
} else {
  await manifest.createPullRequests();
}
