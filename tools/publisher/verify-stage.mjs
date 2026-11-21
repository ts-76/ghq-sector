import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { submitStage } from "./submit-stage.mjs";

test("the locked publisher stages the supplied bytes with a scoped token", async (t) => {
  const bytes = Buffer.from("fixture tarball bytes");
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks)),
    });
    response.writeHead(201, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ stageId: "test-stage-id" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const registry = `http://127.0.0.1:${server.address().port}/`;
  const manifest = { name: "ghq-sector", version: "1.4.1" };
  const stageId = await submitStage(manifest, bytes, {
    registry,
    token: "fixture-token",
    provenance: false,
  });
  assert.equal(stageId, "test-stage-id");
  assert.equal(requests.length, 1);
  const [{ method, path, authorization, body }] = requests;
  assert.equal(method, "POST");
  assert.equal(path, "/-/stage/package/ghq-sector");
  assert.equal(authorization, "Bearer fixture-token");
  assert.equal(body["dist-tags"].latest, manifest.version);
  assert.equal(body.access, "public");
  assert.equal(
    body.versions[manifest.version].dist.integrity,
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  );
  assert.deepEqual(
    Buffer.from(body._attachments["ghq-sector-1.4.1.tgz"].data, "base64"),
    bytes,
  );
});
