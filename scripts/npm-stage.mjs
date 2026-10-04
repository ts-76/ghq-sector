import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const policy = await readJson(join(root, "tools/publisher/risk-scope.json"));
const registry = "https://registry.npmjs.org/";

export function requireSource(actual, expected) {
  assert.match(expected || "", /^[a-f0-9]{40}$/);
  assert.equal(actual, expected, "Source changed since authorization");
}

export function requirePublisherAudit(report, consent, version) {
  assert.ok(!report.error, "Publisher audit service failed");
  assert.ok(report.vulnerabilities && report.metadata?.vulnerabilities);
  assert.equal(
    report.metadata.vulnerabilities.total,
    Object.keys(report.vulnerabilities).length,
    "Incomplete audit report",
  );
  if (report.metadata.vulnerabilities.total === 0) return;
  assert.equal(
    consent,
    "true",
    "Explicit one-off publisher risk consent required",
  );
  assert.equal(
    version,
    policy.version,
    "Risk consent only covers ghq-sector 1.4.0",
  );
  const packages = new Set([
    ...Object.keys(policy.packages),
    ...policy.propagated,
  ]);
  const advisories = new Set(policy.advisories);
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    assert.ok(packages.has(name), `Unreviewed publisher package: ${name}`);
    assert.notEqual(
      entry.severity,
      "critical",
      "Critical risk is outside this scope",
    );
    assert.ok(
      Array.isArray(entry.via) && entry.via.length > 0,
      "Incomplete advisory chain",
    );
    assert.ok(
      ["info", "low", "moderate", "high"].includes(entry.severity),
      "Unknown severity",
    );
    for (const via of entry.via) {
      if (typeof via === "string") {
        assert.ok(packages.has(via), `Unreviewed propagation: ${via}`);
      } else {
        const id = via.url?.match(
          /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/,
        )?.[1];
        assert.ok(
          advisories.has(id),
          `Unreviewed publisher advisory: ${via.url}`,
        );
      }
    }
  }
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

export async function inspectArtifact(tarball, sourceSha) {
  const bytes = await readFile(tarball);
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  assert.equal(manifest.name, "ghq-sector");
  assert.equal(manifest.version, policy.version);
  assert.equal(manifest.license, "MIT");
  for (const alias of ["gsec", "ghq-sector"])
    assert.equal(manifest.bin[alias], "dist/cli/main.mjs");
  const files = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
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
    name: manifest.name,
    version: manifest.version,
    sourceSha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

export function stageArguments(tarball, fixture) {
  return [
    "stage",
    "publish",
    resolve(tarball),
    "--ignore-scripts",
    "--provenance",
    "--access=public",
    "--tag=latest",
    "--json",
    `--registry=${registry}`,
    `--userconfig=${join(fixture, "user.npmrc")}`,
    `--globalconfig=${join(fixture, "global.npmrc")}`,
    `--cache=${join(fixture, "empty-cache")}`,
    "--proxy=null",
    "--https-proxy=null",
    "--fetch-retries=0",
    "--fetch-timeout=30000",
  ];
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
    "24.19.0",
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
  const artifactRoot = resolve("npm-stage-artifact");
  const tarball = join(artifactRoot, "ghq-sector-1.4.0.tgz");
  if (mode === "prepare") {
    assert.equal((await readJson("package.json")).version, policy.version);
    await mkdir(artifactRoot, { recursive: true });
    execFileSync(
      "bun",
      ["pm", "pack", "--ignore-scripts", "--filename", tarball, "--quiet"],
      { env: publisherEnvironment(process.env), stdio: "pipe" },
    );
    const evidence = await inspectArtifact(tarball, sha);
    evidence.runId = process.env.GITHUB_RUN_ID;
    evidence.runAttempt = process.env.GITHUB_RUN_ATTEMPT;
    await writeFile(
      join(artifactRoot, "evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
    console.log(JSON.stringify(evidence));
    return;
  }
  assert.equal(mode, "stage");
  assert.equal(process.env.GHQ_SECTOR_STAGING_ENABLED, "true");
  assert.equal(process.env.PUBLISHER_RISK_CONSENT, "true");
  const evidence = await readJson(join(artifactRoot, "evidence.json"));
  const inspected = await inspectArtifact(tarball, sha);
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
    !metadata.versions?.[policy.version],
    "Version is already public; do not resubmit",
  );
  assert.ok(metadata.maintainers?.some((owner) => owner.name === "ts-76"));
  const cli = join(root, "tools/publisher/node_modules/npm/bin/npm-cli.js");
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
    }).trim(),
    policy.npmVersion,
  );
  for (const [name, version] of Object.entries(policy.packages))
    assert.equal(
      (
        await readJson(
          join(
            root,
            "tools/publisher/node_modules/npm/node_modules",
            name,
            "package.json",
          ),
        )
      ).version,
      version,
    );
  const fixture = await mkdtemp(join(tmpdir(), "ghq-sector-stage-"));
  await writeFile(join(fixture, "user.npmrc"), `registry=${registry}\n`);
  await writeFile(join(fixture, "global.npmrc"), "");
  const cleanEnv = publisherEnvironment(process.env);
  const configArgs = [
    `--userconfig=${join(fixture, "user.npmrc")}`,
    `--globalconfig=${join(fixture, "global.npmrc")}`,
    `--cache=${join(fixture, "audit-cache")}`,
  ];
  const audit = spawnSync(
    process.execPath,
    [cli, "audit", "--json", "--audit-level=moderate", ...configArgs],
    {
      cwd: join(root, "tools/publisher"),
      env: Object.fromEntries(
        Object.entries(cleanEnv).filter(
          ([key]) =>
            !key.startsWith("ACTIONS_ID_TOKEN") && key !== "GITHUB_ACTIONS",
        ),
      ),
      encoding: "utf8",
      timeout: 60000,
    },
  );
  assert.ok(
    audit.status === 0 || audit.status === 1,
    "Publisher audit did not complete",
  );
  await writeFile("publisher-audit.json", audit.stdout);
  requirePublisherAudit(
    JSON.parse(audit.stdout),
    process.env.PUBLISHER_RISK_CONSENT,
    evidence.version,
  );
  const result = spawnSync(
    process.execPath,
    [cli, ...stageArguments(tarball, fixture)],
    { cwd: fixture, env: cleanEnv, encoding: "utf8", timeout: 120000 },
  );
  // npm may print authentication diagnostics; do not echo raw output or URLs.
  assert.equal(
    result.status,
    0,
    "Stage failed; inspect npm/Actions authentication settings before retrying",
  );
  const receipt = JSON.parse(result.stdout);
  const item = Array.isArray(receipt)
    ? receipt[0]
    : receipt["ghq-sector"] || receipt;
  assert.equal(item.name, "ghq-sector");
  assert.equal(item.version, policy.version);
  assert.equal(item.integrity, evidence.integrity);
  assert.ok(
    item.stageId,
    "Stage ID missing; verify remote state before retrying",
  );
  assert.deepEqual(await inspectArtifact(tarball, sha), inspected);
  await writeFile(
    "npm-stage-receipt.json",
    `${JSON.stringify({ ...evidence, stageId: item.stageId, status: "awaiting owner 2FA approval" }, null, 2)}\n`,
  );
  console.log(
    `Stage ${item.stageId} submitted. Owner review and npm 2FA approval are required.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv[2]);
