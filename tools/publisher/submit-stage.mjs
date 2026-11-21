import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import libnpmpublish from "libnpmpublish";

const npmRegistry = "https://registry.npmjs.org/";

async function requestJson(url, token, method) {
  assert.ok(token, "OIDC credential missing");
  const response = await fetch(url, {
    method,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(response.ok);
  return response.json();
}

async function exchangeToken(env) {
  const request = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.equal(request.protocol, "https:");
  assert.ok(request.hostname.endsWith(".actions.githubusercontent.com"));
  assert.ok(!request.username && !request.password && !request.port);
  request.searchParams.set("audience", "npm:registry.npmjs.org");
  const { value } = await requestJson(
    request,
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "GET",
  );
  const endpoint = new URL(
    "/-/npm/v1/oidc/token/exchange/package/ghq-sector",
    npmRegistry,
  );
  const { token } = await requestJson(endpoint, value, "POST");
  assert.ok(typeof token === "string" && token.length > 0);
  return token;
}

export async function submitStage(
  manifest,
  bytes,
  { registry, token, provenance },
) {
  const { host, pathname } = new URL(registry);
  const response = await libnpmpublish.publish(manifest, bytes, {
    registry,
    [`//${host}${pathname}:_authToken`]: token,
    stage: true,
    provenance,
    access: "public",
    defaultTag: "latest",
    fetchRetries: 0,
    timeout: 30000,
  });
  assert.match(response.stageId || "", /^[a-zA-Z0-9-]{1,100}$/);
  return response.stageId;
}

async function main() {
  const manifest = JSON.parse(process.argv[2]);
  assert.equal(manifest.name, "ghq-sector");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length);

  // Distinguish failures without logging authentication or registry error bodies.
  let token;
  try {
    token = await exchangeToken(process.env);
  } catch {
    process.exitCode = 2;
    return;
  }
  try {
    console.log(
      await submitStage(manifest, bytes, {
        registry: npmRegistry,
        token,
        provenance: true,
      }),
    );
  } catch {
    process.exitCode = 3;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
