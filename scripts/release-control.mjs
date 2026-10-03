import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { GitHub, Manifest } from "release-please";
import { executeVerifiedRelease } from "./release-execution.mjs";

const mode = process.argv[2] || "preview";
assert.ok(["preview", "pr", "release"].includes(mode), "Unknown release mode");
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
} else if (mode === "pr") {
  await manifest.createPullRequests();
} else {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const release = await executeVerifiedRelease({
    github,
    manifest,
    verifiedSha: process.env.GITHUB_SHA,
    version: packageJson.version,
  });
  const outputs = [`release_created=${Boolean(release)}`];
  if (release) {
    assert.equal(release.path, ".");
    assert.match(release.sha, /^[a-f0-9]{40}$/);
    assert.equal(release.tagName, `v${release.version}`);
    outputs.push(`sha=${release.sha}`, `tag_name=${release.tagName}`);
  }
  assert.ok(process.env.GITHUB_OUTPUT, "GitHub job output path is required");
  await appendFile(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
}
