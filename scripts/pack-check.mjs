import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "ghq-sector-pack-check-"));
const env = { ...process.env };
for (const key of [
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
])
  delete env[key];
try {
  const packed = spawnSync(
    "bun",
    [
      "pm",
      "pack",
      "--ignore-scripts",
      "--filename",
      join(temp, "package-check.tgz"),
      "--quiet",
    ],
    { encoding: "utf8", env },
  );
  assert.equal(packed.status, 0, packed.stderr || packed.error?.message);
  const filename = "package-check.tgz";
  const tarball = join(temp, filename);
  const contents = spawnSync("tar", ["-xOf", tarball, "package/package.json"], {
    encoding: "utf8",
  });
  assert.equal(contents.status, 0, contents.stderr);
  const manifest = JSON.parse(contents.stdout);
  const expected = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.name, expected.name);
  assert.equal(manifest.version, expected.version);
  const listed = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  const files = new Set(listed.stdout.trim().split("\n"));
  for (const name of ["gsec", "ghq-sector"])
    assert.equal(manifest.bin[name], "dist/cli/main.mjs");
  for (const file of [
    "dist/cli/main.mjs",
    "dist/ui-dist/index.html",
    "LICENSE",
  ])
    assert.ok(files.has(`package/${file}`), `Package is missing ${file}`);
  assert.ok(
    [...files].some((file) => file.startsWith("package/dist/ui-dist/assets/")),
    "Missing built UI assets",
  );
  console.log(
    JSON.stringify(
      {
        name: manifest.name,
        version: manifest.version,
        checkedBins: manifest.bin,
        files: files.size,
        publication: "disabled",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
