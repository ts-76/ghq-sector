import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const publisherRoot = join(root, "tools/publisher");
const registry = "https://registry.npmjs.org/";

export function requireSource(actual, expected) {
  assert.match(expected || "", /^[a-f0-9]{40}$/);
  assert.equal(actual, expected, "Source changed since authorization");
}

export function requirePublisherAudit(report) {
  assert.ok(!report.error, "Publisher audit service failed");
  assert.ok(report.vulnerabilities && report.metadata?.vulnerabilities);
  assert.equal(
    report.metadata.vulnerabilities.total,
    0,
    "Publisher audit reported vulnerabilities",
  );
  assert.deepEqual(report.vulnerabilities, {}, "Incomplete audit report");
}

export function requireEnvironmentReview(environment, rules) {
  assert.equal(environment.name, "npm-stage");
  assert.equal(environment.can_admins_bypass, false);
  const review = environment.protection_rules?.find(
    (rule) => rule.type === "required_reviewers",
  );
  assert.ok(review, "Owner approval is required before OIDC access");
  assert.deepEqual(
    review.reviewers.map((item) => [item.type, item.reviewer.id]),
    [["User", 108617014]],
  );
  assert.equal(
    environment.deployment_branch_policy?.custom_branch_policies,
    true,
  );
  assert.equal(environment.deployment_branch_policy?.protected_branches, false);
  assert.deepEqual(
    rules.branch_policies.map((rule) => [rule.name, rule.type]),
    [["main", "branch"]],
  );
}

export function requireEvidence(evidence, inspected, runId, runAttempt) {
  for (const [key, value] of Object.entries(inspected))
    assert.equal(evidence[key], value, `Artifact ${key} mismatch`);
  assert.equal(evidence.runId, runId);
  assert.equal(
    evidence.runAttempt,
    runAttempt,
    "Rerun preparation for this attempt",
  );
}

async function readArtifact(tarball, sourceSha, version) {
  const bytes = await readFile(tarball);
  const tarOptions = { input: bytes, encoding: "utf8" };
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOzf", "-", "package/package.json"], tarOptions),
  );
  assert.equal(manifest.name, "ghq-sector");
  assert.equal(manifest.version, version, "Artifact version differs");
  assert.equal(manifest.license, "MIT");
  for (const alias of ["gsec", "ghq-sector"])
    assert.equal(manifest.bin[alias], "dist/cli/main.mjs");
  const files = execFileSync("tar", ["-tzf", "-"], tarOptions)
    .trim()
    .split("\n");
  for (const file of files) {
    assert.match(
      file,
      /^package\/(?:package\.json|README\.md|LICENSE|dist\/[a-zA-Z0-9_./-]+)$/,
    );
    assert.ok(!file.split("/").includes(".."));
  }
  for (const file of [
    "package/dist/cli/main.mjs",
    "package/dist/ui-dist/index.html",
    "package/LICENSE",
  ])
    assert.ok(files.includes(file));
  assert.ok(
    files.some((file) => file.startsWith("package/dist/ui-dist/assets/")),
  );
  return {
    bytes,
    manifest,
    inspected: {
      name: manifest.name,
      version,
      sourceSha,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    },
  };
}

export function publisherEnvironment(env) {
  const keys = [
    "PATH",
    "TMPDIR",
    "GITHUB_ACTIONS",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REPOSITORY_OWNER_ID",
    "GITHUB_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_SERVER_URL",
    "GITHUB_EVENT_NAME",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "RUNNER_ENVIRONMENT",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  ];
  return Object.fromEntries(
    keys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  );
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        }
      : {},
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(
    response.status,
    200,
    `Preflight failed: HTTP ${response.status}`,
  );
  return response.json();
}

async function main(mode) {
  assert.equal(
    process.versions.node,
    "24.22.3",
    "Use the reviewed Node version",
  );
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "ts-76/ghq-sector");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  requireSource(sha, process.env.EXPECTED_RELEASE_SHA);
  requireSource(sha, process.env.GITHUB_SHA);
  requireSource(sha, process.env.GITHUB_WORKFLOW_SHA);
  assert.equal(
    process.env.GITHUB_WORKFLOW_REF,
    "ts-76/ghq-sector/.github/workflows/release.yml@refs/heads/main",
  );
  assert.match(process.env.GITHUB_RUN_ID || "", /^[0-9]+$/);
  assert.match(process.env.GITHUB_RUN_ATTEMPT || "", /^[1-9][0-9]*$/);
  const version = process.env.EXPECTED_RELEASE_VERSION || "";
  assert.match(version, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  assert.equal((await readJson("package.json")).version, version);
  assert.equal((await readJson(".release-please-manifest.json"))["."], version);
  const artifactRoot = resolve("npm-stage-artifact");
  const tarball = join(artifactRoot, `ghq-sector-${version}.tgz`);
  if (mode === "prepare") {
    await mkdir(artifactRoot, { recursive: true });
    execFileSync(
      "bun",
      ["pm", "pack", "--ignore-scripts", "--filename", tarball, "--quiet"],
      { env: publisherEnvironment(process.env), stdio: "pipe" },
    );
    const { inspected } = await readArtifact(tarball, sha, version);
    const evidence = {
      ...inspected,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    };
    await writeFile(
      join(artifactRoot, "evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    await appendFile(process.env.GITHUB_OUTPUT, `sha256=${evidence.sha256}\n`);
    console.log(JSON.stringify(evidence));
    return;
  }
  assert.equal(mode, "stage");
  assert.equal(process.env.GHQ_SECTOR_STAGING_ENABLED, "true");
  const evidence = await readJson(join(artifactRoot, "evidence.json"));
  const { bytes, manifest, inspected } = await readArtifact(
    tarball,
    sha,
    version,
  );
  const preparedSha256 = process.env.PREPARED_TARBALL_SHA256 || "";
  assert.match(preparedSha256, /^[a-f0-9]{64}$/);
  assert.equal(inspected.sha256, preparedSha256, "Tarball from verify changed");
  requireEvidence(
    evidence,
    inspected,
    process.env.GITHUB_RUN_ID,
    process.env.GITHUB_RUN_ATTEMPT,
  );
  const api = "https://api.github.com/repos/ts-76/ghq-sector";
  const token = process.env.GITHUB_TOKEN;
  const repository = await getJson(api, token);
  assert.equal(repository.private, false);
  const current = await getJson(`${api}/branches/main`, token);
  requireSource(current.commit.sha, sha);
  const environment = await getJson(`${api}/environments/npm-stage`, token);
  const rules = await getJson(
    `${api}/environments/npm-stage/deployment-branch-policies`,
    token,
  );
  requireEnvironmentReview(environment, rules);
  const metadata = await getJson(`${registry}ghq-sector`);
  assert.ok(
    !metadata.versions?.[version],
    "Version is already public; do not resubmit",
  );
  assert.ok(metadata.maintainers?.some((owner) => owner.name === "ts-76"));
  const fixture = await mkdtemp(join(tmpdir(), "ghq-sector-stage-"));
  await writeFile(join(fixture, "user.npmrc"), `registry=${registry}\n`);
  await writeFile(join(fixture, "global.npmrc"), "");
  const cleanEnv = { ...publisherEnvironment(process.env), HOME: fixture };
  const configArgs = [
    `--userconfig=${join(fixture, "user.npmrc")}`,
    `--globalconfig=${join(fixture, "global.npmrc")}`,
    `--cache=${join(fixture, "audit-cache")}`,
  ];
  const audit = spawnSync(
    "npm",
    [
      "audit",
      "--json",
      "--audit-level=low",
      `--registry=${registry}`,
      "--fetch-retries=0",
      "--fetch-timeout=30000",
      ...configArgs,
    ],
    {
      cwd: publisherRoot,
      env: { PATH: cleanEnv.PATH, HOME: fixture },
      encoding: "utf8",
      timeout: 60000,
    },
  );
  if (audit.stdout) await writeFile("publisher-audit.json", audit.stdout);
  assert.equal(audit.status, 0, "Publisher audit failed");
  requirePublisherAudit(JSON.parse(audit.stdout));
  const result = spawnSync(
    process.execPath,
    [join(publisherRoot, "submit-stage.mjs"), JSON.stringify(manifest)],
    {
      cwd: fixture,
      input: bytes,
      env: cleanEnv,
      encoding: "utf8",
      timeout: 120000,
    },
  );
  // The publisher emits only the stage ID. Authentication diagnostics may contain credentials.
  assert.equal(
    result.status,
    0,
    result.status === 2
      ? "GitHub-to-npm OIDC exchange failed"
      : "Stage or provenance failed; inspect the registry before retrying",
  );
  const stageId = result.stdout.trim();
  assert.match(
    stageId,
    /^[a-zA-Z0-9-]{1,100}$/,
    "Stage ID missing; verify remote state before retrying",
  );
  await writeFile(
    "npm-stage-receipt.json",
    `${JSON.stringify({ ...evidence, stageId, status: "awaiting owner 2FA approval" }, null, 2)}\n`,
  );
  console.log(
    `Stage ${stageId} submitted. Owner review and npm 2FA approval are required.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
