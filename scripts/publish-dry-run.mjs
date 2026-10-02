import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "ghq-sector-publish-check-"));
const cli = resolve(".github/publish-cli/node_modules/npm/bin/npm-cli.js");
const env = { ...process.env };
// A dry run must not exchange OIDC credentials or consult local npm credentials.
for (const key of [
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
]) {
  delete env[key];
}
await writeFile(join(temp, "npmrc"), "");
env.NPM_CONFIG_USERCONFIG = join(temp, "npmrc");
await writeFile(join(temp, "global-npmrc"), "");
env.NPM_CONFIG_GLOBALCONFIG = join(temp, "global-npmrc");
const run = (args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env,
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.error?.message || "npm check failed",
    );
  }
  return JSON.parse(result.stdout);
};
try {
  const options = [
    "--ignore-scripts",
    "--offline",
    "--cache",
    join(temp, "cache"),
    "--json",
  ];
  const [packed] = run(["pack", "--pack-destination", temp, ...options]);
  const contents = spawnSync(
    "tar",
    ["-xOf", join(temp, packed.filename), "package/package.json"],
    {
      encoding: "utf8",
    },
  );
  assert.equal(contents.status, 0, contents.stderr);
  const manifest = JSON.parse(contents.stdout);
  for (const name of ["gsec", "ghq-sector"]) {
    assert.equal(manifest.bin[name], "dist/cli/main.mjs");
  }
  const files = new Set(packed.files.map((file) => file.path));
  for (const path of [
    "dist/cli/main.mjs",
    "dist/ui-dist/index.html",
    "LICENSE",
  ]) {
    assert.ok(files.has(path), `Package is missing ${path}`);
  }
  // Offline with a fresh cache permits checking an already published version.
  // The explicit dry-run flag is mandatory: no package is sent to the registry.
  const published = run([
    "publish",
    join(temp, packed.filename),
    "--dry-run",
    "--access",
    "public",
    ...options,
  ]);
  console.log(
    JSON.stringify({ package: published, checkedBins: manifest.bin }, null, 2),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
