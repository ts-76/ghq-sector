import { spawn } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GhOwnerCandidate } from "../src/shared/gh.js";
import { requestRepoProposal } from "../ui/src/repo-proposal.js";
import { createConfig, makeTempRoot } from "./helpers.js";

const servers: { stop(): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

async function fixture(host = "127.0.0.1") {
  const root = await makeTempRoot();
  const config = {
    ...createConfig(root),
    repos: [],
    agentSkills: { enabled: false },
  };
  const configPath = path.join(root, "ghq-sector.config.json");
  const uiDistRoot = path.join(root, "ui");
  await mkdir(uiDistRoot);
  await writeFile(path.join(uiDistRoot, "index.html"), "local editor");
  await writeFile(configPath, JSON.stringify(config));
  vi.doMock("../src/shared/ghq.js", () => ({
    getGhqRoot: vi.fn(async () => {
      throw new Error("isolated fixture");
    }),
  }));
  const listGhOwnerCandidates = vi.fn(async (): Promise<GhOwnerCandidate[]> => {
    throw new Error("isolated fixture");
  });
  const listGhRepositories = vi.fn(async () => []);
  vi.doMock("../src/shared/gh.js", () => ({
    listGhOwnerCandidates,
    listGhRepositories,
  }));
  const { createEditServer, MAX_EDITOR_BODY_BYTES } =
    await import("../src/commands/edit.js");
  const options = { host, port: 0, configPath, uiDistRoot };
  const server = await createEditServer(options);
  servers.push(server);
  const origin = `http://${host === "::1" ? "[::1]" : host}:${server.port}`;
  return {
    root,
    config,
    configPath,
    options,
    server,
    origin,
    revision: await getConfigRevision(origin),
    createEditServer,
    MAX_EDITOR_BODY_BYTES,
    listGhOwnerCandidates,
    listGhRepositories,
  };
}

function request(
  origin: string,
  route: string,
  options: {
    method?: string;
    headers?: Record<string, string | undefined>;
    body?: string | Buffer;
    chunks?: string[];
  } = {},
) {
  return new Promise<{
    status: number;
    text: string;
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
  }>((resolve, reject) => {
    const req = httpRequest(
      `${origin}${route}`,
      {
        method: options.method ?? "GET",
        agent: false,
        headers: {
          "X-Ghq-Sector-Request": "1",
          Connection: "keep-alive",
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let body = {};
          try {
            body = JSON.parse(text);
          } catch {
            /* static asset */
          }
          resolve({
            status: response.statusCode ?? 0,
            text,
            headers: response.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end(options.body);
  });
}

async function getConfigRevision(origin: string) {
  const result = await request(origin, "/api/config");
  const revision = result.headers.etag;
  if (result.status !== 200 || typeof revision !== "string")
    throw new Error("Expected a config revision");
  return revision;
}

function json(config: unknown, method = "PUT", revision?: string) {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(revision ? { "If-Match": revision } : {}),
    },
    body: JSON.stringify(config),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("local editor HTTP boundaries", () => {
  it("requires a revision and preserves the first tab's save on stale Save or Apply", async () => {
    const f = await fixture();
    const original = await readFile(f.configPath, "utf8");
    const first = { ...f.config, categories: ["first-tab"] };
    const second = { ...f.config, categories: ["second-tab"] };
    const missing = await request(f.origin, "/api/config", json(first));
    expect(missing.status).toBe(428);
    expect(await readFile(f.configPath, "utf8")).toBe(original);

    const saved = await request(
      f.origin,
      "/api/config",
      json(first, "PUT", f.revision),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.revision).toBe(await getConfigRevision(f.origin));
    expect(saved.body.revision).not.toBe(f.revision);
    for (const [route, method] of [
      ["/api/config", "PUT"],
      ["/api/apply", "POST"],
    ]) {
      const response = await request(
        f.origin,
        route,
        json(second, method, f.revision),
      );
      expect(response.status).toBe(412);
      expect(response.body.code).toBe("CONFIG_CHANGED");
    }
    expect(JSON.parse(await readFile(f.configPath, "utf8")).categories).toEqual(
      ["first-tab"],
    );
    await expect(access(f.config.workspaceRoot)).rejects.toThrow();
  });

  it("rejects duplicate link destinations in Preview and before Apply saves", async () => {
    const f = await fixture();
    const [repo] = createConfig(f.root).repos;
    if (!repo) throw new Error("Expected a repo fixture");
    const draft = { ...f.config, repos: [repo, { ...repo, owner: "another" }] };
    for (const entry of draft.repos) {
      await mkdir(
        path.join(f.config.ghqRoot, entry.provider, entry.owner, entry.name),
        {
          recursive: true,
        },
      );
    }
    const original = await readFile(f.configPath, "utf8");
    for (const route of ["/api/preview", "/api/apply"]) {
      const response = await request(
        f.origin,
        route,
        json(draft, "POST", f.revision),
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("WORKSPACE_SYNC_CONFLICT");
      expect(response.body.message).toContain(repo.name);
      expect(response.body.result).toBeUndefined();
    }
    expect(await readFile(f.configPath, "utf8")).toBe(original);
    await expect(access(f.config.workspaceRoot)).rejects.toThrow();
  });

  it("reuses the account lookup when listing GitHub repositories", async () => {
    const f = await fixture();
    const unavailable = await request(f.origin, "/api/gh/repos");
    expect(unavailable.body).toMatchObject({ available: false, accounts: [] });
    expect(f.listGhOwnerCandidates).toHaveBeenCalledTimes(1);
    expect(f.listGhRepositories).not.toHaveBeenCalled();

    const accounts = [{ login: "fixture", active: true }];
    f.listGhOwnerCandidates.mockResolvedValueOnce(accounts);
    const available = await request(f.origin, "/api/gh/repos?owner=fixture");
    expect(available.body).toMatchObject({
      available: true,
      owner: "fixture",
      accounts,
    });
    expect(f.listGhOwnerCandidates).toHaveBeenCalledTimes(2);
    expect(f.listGhRepositories).toHaveBeenCalledExactlyOnceWith("fixture");
  });

  it.each(["127.0.0.1", "localhost", "::1"])(
    "supports legitimate reads, Save, Preview and Apply on %s",
    async (host) => {
      const f = await fixture(host);
      const response = await request(f.origin, "/api/config", {
        headers: { Origin: f.origin },
      });
      expect(response.status).toBe(200);
      expect(response.body.raw).toBe(JSON.stringify(f.config));
      const draft = { ...f.config, categories: ["draft"] };
      const saved = await request(
        f.origin,
        "/api/config",
        json(draft, "PUT", f.revision),
      );
      expect(saved.status).toBe(200);
      expect(
        (await request(f.origin, "/api/preview", json(draft, "POST"))).status,
      ).toBe(200);
      expect(
        (
          await request(
            f.origin,
            "/api/apply",
            json(draft, "POST", await getConfigRevision(f.origin)),
          )
        ).status,
      ).toBe(200);
      expect(
        JSON.parse(await readFile(f.configPath, "utf8")).categories,
      ).toEqual(["draft"]);
      expect(
        await readFile(path.join(f.config.workspaceRoot, "AGENTS.md"), "utf8"),
      ).toContain("ghq-sector");
    },
  );

  it("prevents UI framing on assets and API success/error responses", async () => {
    const f = await fixture();
    for (const [route, options] of [
      ["/", {}],
      ["/api/config", {}],
      ["/api/config", { headers: { Host: "foreign.test" } }],
    ] as const) {
      const result = await request(f.origin, route, options);
      expect(result.headers["content-security-policy"]).toBe(
        "frame-ancestors 'none'",
      );
      expect(result.headers["x-frame-options"]).toBe("DENY");
    }
  });

  it.each(["template", "selected GitHub repo"])(
    "uses the bundled UI proposal contract for %s without saving the draft",
    async (action) => {
      const f = await fixture();
      const draft = {
        ...f.config,
        categories: ["unsaved"],
        defaults: { category: "unsaved", owner: "draft-owner" },
      };
      const repo = {
        provider: "github.com",
        owner: "draft-owner",
        name: action === "template" ? "" : "chosen",
        category: "unsaved",
      };
      const send: typeof fetch = (input, init) =>
        fetch(new URL(String(input), f.origin), {
          ...init,
          headers: { ...init?.headers, Origin: f.origin },
        });
      const nextDraft = await requestRepoProposal(
        draft,
        action === "template" ? undefined : repo,
        send,
      );
      expect(nextDraft).toMatchObject({
        categories: ["unsaved"],
        repos: [repo],
      });
      expect(JSON.parse(await readFile(f.configPath, "utf8"))).toEqual(
        f.config,
      );
      expect(
        (
          await request(
            f.origin,
            "/api/config",
            json(nextDraft, "PUT", await getConfigRevision(f.origin)),
          )
        ).status,
      ).toBe(200);
      expect(JSON.parse(await readFile(f.configPath, "utf8"))).toEqual(
        nextDraft,
      );
    },
  );

  it("rejects public binds before loading config or building UI", async () => {
    const { runEdit, createEditServer } =
      await import("../src/commands/edit.js");
    for (const host of ["0.0.0.0", "::", "example.com", "192.168.1.10"]) {
      await expect(
        runEdit({ host, config: "/missing", open: false }),
      ).rejects.toThrow("loopback");
      await expect(
        createEditServer({
          host,
          port: 0,
          configPath: "/missing",
          uiDistRoot: "/missing",
        }),
      ).rejects.toThrow("loopback");
    }
  });

  it("rejects invalid Host and foreign Origin before reads or writes", async () => {
    const f = await fixture();
    const original = await readFile(f.configPath, "utf8");
    for (const headers of [
      { Host: "example.com" },
      { Origin: "https://example.com" },
      { Origin: "null" },
      { Origin: f.origin, "Sec-Fetch-Site": "cross-site" },
    ]) {
      for (const [route, options] of [
        ["/api/config", {}],
        ["/api/doctor", {}],
        ["/api/repo-template", {}],
        ["/api/gh/repos", {}],
        ["/api/config", json(f.config)],
        ["/api/preview", json(f.config, "POST")],
        ["/api/apply", json(f.config, "POST")],
      ] as const) {
        expect(
          (
            await request(f.origin, route, {
              ...options,
              headers: { ...options.headers, ...headers },
            })
          ).status,
        ).toBe(403);
      }
    }
    expect(await readFile(f.configPath, "utf8")).toBe(original);
    expect(
      (await request(f.origin, "/", { headers: { Host: "example.com" } }))
        .status,
    ).toBe(403);
  });

  it("requires an explicit local header for clients without Origin unless browser same-origin", async () => {
    const f = await fixture();
    expect(
      (
        await request(f.origin, "/api/config", {
          headers: { "X-Ghq-Sector-Request": "" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(f.origin, "/api/config", {
          headers: {
            "X-Ghq-Sector-Request": "",
            "Sec-Fetch-Site": "same-origin",
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(f.origin, "/api/config", {
          headers: { "X-Ghq-Sector-Request": "", Origin: f.origin },
        })
      ).status,
    ).toBe(200);
  });

  it.each([
    ["invalid JSON", "{", "application/json", 400],
    ["empty JSON", "", "application/json", 400],
    ["schema mismatch", '{"ghqRoot":42}', "application/json", 400],
    ["form body", "a=b", "application/x-www-form-urlencoded", 415],
    ["plain body", "{}", "text/plain", 415],
  ])(
    "returns controlled errors for %s without changing config",
    async (_label, body, type, status) => {
      const f = await fixture();
      const original = await readFile(f.configPath, "utf8");
      for (const [route, method] of [
        ["/api/config", "PUT"],
        ["/api/preview", "POST"],
        ["/api/apply", "POST"],
        ["/api/repos", "POST"],
      ]) {
        const result = await request(f.origin, route, {
          method,
          body: String(body),
          headers: { "Content-Type": String(type) },
        });
        expect(result.status).toBe(status);
        expect(result.body.ok).toBe(false);
      }
      expect(await readFile(f.configPath, "utf8")).toBe(original);
    },
  );

  it("rejects malformed UTF-8 and missing Content-Type", async () => {
    const f = await fixture();
    expect(
      (
        await request(f.origin, "/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: Buffer.from([0x22, 0xff, 0x22]),
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(f.origin, "/api/config", { method: "PUT", body: "{}" }))
        .status,
    ).toBe(415);
  });

  it("rejects oversized fixed and chunked bodies and unsupported encoding", async () => {
    const f = await fixture();
    const original = await readFile(f.configPath, "utf8");
    expect(
      (
        await request(f.origin, "/api/config", {
          ...json(f.config),
          body: " ".repeat(f.MAX_EDITOR_BODY_BYTES + 1),
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(f.MAX_EDITOR_BODY_BYTES + 1),
          },
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(f.origin, "/api/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          chunks: Array.from({ length: 17 }, () => " ".repeat(65536)),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(f.origin, "/api/config", {
          ...json(f.config),
          headers: {
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
          },
        })
      ).status,
    ).toBe(415);
    expect(await readFile(f.configPath, "utf8")).toBe(original);
  });

  it("returns repo proposals from the caller's draft without persisting", async () => {
    const f = await fixture();
    const original = await readFile(f.configPath, "utf8");
    const draft = {
      ...f.config,
      categories: ["unsaved"],
      defaults: { category: "unsaved", owner: "draft-owner" },
    };
    const result = await request(
      f.origin,
      "/api/repos",
      json({ config: draft }, "POST"),
    );
    expect(result.status).toBe(200);
    expect(result.body.value).toMatchObject({
      categories: ["unsaved"],
      repos: [{ owner: "draft-owner", category: "unsaved" }],
    });
    expect(
      (await request(f.origin, "/api/repos", json({ repo: {} }, "POST")))
        .status,
    ).toBe(400);
    expect(await readFile(f.configPath, "utf8")).toBe(original);
  });

  it("rejects concurrent Apply and Save across editor instances and releases the lease", async () => {
    const entered = deferred();
    const release = deferred();
    const runHooks = vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return [];
    });
    vi.doMock("../src/hooks/run-hooks.js", () => ({ runHooks }));
    const f = await fixture();
    const second = await f.createEditServer(f.options);
    servers.push(second);
    const secondOrigin = `http://127.0.0.1:${second.port}`;
    const apply = request(
      f.origin,
      "/api/apply",
      json(f.config, "POST", f.revision),
    );
    try {
      await entered.promise;
      expect(
        (await request(secondOrigin, "/api/apply", json(f.config, "POST")))
          .status,
      ).toBe(409);
      expect(
        (
          await request(
            secondOrigin,
            "/api/config",
            json({ ...f.config, categories: ["racing"] }),
          )
        ).status,
      ).toBe(409);
      expect((await request(f.origin, "/api/config")).status).toBe(409);
      expect(
        JSON.parse(await readFile(f.configPath, "utf8")).categories,
      ).toEqual(f.config.categories);
      expect(runHooks).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    expect((await apply).status).toBe(200);
    expect(
      (
        await request(
          secondOrigin,
          "/api/config",
          json(f.config, "PUT", await getConfigRevision(secondOrigin)),
        )
      ).status,
    ).toBe(200);
  });

  it("shares the update lease across separate editor processes", async () => {
    const f = await fixture();
    const enteredPath = path.join(f.root, "hook-entered");
    const releasePath = path.join(f.root, "hook-release");
    const hookScript = path.join(f.root, "hook.mjs");
    const serverScript = path.join(f.root, "server.mjs");
    await writeFile(
      hookScript,
      `
      import { appendFile, access } from 'node:fs/promises';
      await appendFile(${JSON.stringify(enteredPath)}, 'once\\n');
      const deadline = Date.now() + 10000;
      while (true) {
        try { await access(${JSON.stringify(releasePath)}); break; } catch {}
        if (Date.now() > deadline) throw new Error('fixture hook timed out');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    `,
    );
    await writeFile(
      serverScript,
      `
      import { createEditServer } from ${JSON.stringify(path.resolve("src/commands/edit.ts"))};
      const server = await createEditServer(${JSON.stringify(f.options)});
      console.log(JSON.stringify({ port: server.port }));
    `,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        path.resolve("node_modules/tsx/dist/loader.mjs"),
        serverScript,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stopped = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    let diagnostics = "";
    child.stderr.on("data", (data) => {
      diagnostics += data;
    });
    const childOrigin = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (data) => {
        output += data;
        const firstLine = output.split("\n")[0];
        try {
          resolve(`http://127.0.0.1:${JSON.parse(firstLine).port}`);
        } catch {
          /* wait for complete line */
        }
      });
      child.once("error", reject);
      child.once("exit", () =>
        reject(new Error(`fixture editor stopped: ${diagnostics}`)),
      );
    });
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const draft = {
      ...f.config,
      hooks: {
        afterSync: [`exec ${quote(process.execPath)} ${quote(hookScript)}`],
      },
    };
    const apply = request(
      childOrigin,
      "/api/apply",
      json(draft, "POST", f.revision),
    );
    try {
      await vi
        .waitFor(async () => {
          await access(enteredPath);
        })
        .catch(async () => {
          throw new Error(JSON.stringify(await apply) + diagnostics);
        });
      expect(
        (await request(f.origin, "/api/apply", json(draft, "POST"))).status,
      ).toBe(409);
      expect(
        (await request(f.origin, "/api/config", json(f.config))).status,
      ).toBe(409);
      expect(await readFile(enteredPath, "utf8")).toBe("once\n");
      await writeFile(releasePath, "release");
      expect((await apply).status).toBe(200);
      expect(
        (
          await request(
            f.origin,
            "/api/config",
            json(f.config, "PUT", await getConfigRevision(f.origin)),
          )
        ).status,
      ).toBe(200);
    } finally {
      await appendFile(releasePath, "release");
      await apply;
      child.kill("SIGTERM");
      await stopped;
    }
  });

  it("keeps pre-existing leases untouched and reports busy", async () => {
    const f = await fixture();
    const lockPath = `${f.configPath}.editor-lock`;
    await writeFile(lockPath, "stale lease marker");
    expect(
      (await request(f.origin, "/api/config", json(f.config))).status,
    ).toBe(409);
    expect(await readFile(lockPath, "utf8")).toBe("stale lease marker");
    expect(JSON.parse(await readFile(f.configPath, "utf8"))).toEqual(f.config);
    await expect(access(f.config.workspaceRoot)).rejects.toThrow();
  });

  it("reports completed phases and sanitizes an actual Apply failure", async () => {
    const f = await fixture();
    const secret = "private-failure-secret";
    const draft = {
      ...f.config,
      resources: [{ from: path.join(f.root, secret), to: "copied" }],
    };
    const result = await request(
      f.origin,
      "/api/apply",
      json(draft, "POST", f.revision),
    );
    expect(result.status).toBe(500);
    expect(result.body.progress).toEqual({
      configSaved: true,
      completed: ["prepare", "repos", "links"],
      failedStage: "resources",
      failedStageMayHaveChanges: true,
    });
    expect(result.text).not.toContain(secret);
    expect(result.text).not.toContain(f.root);
    expect(result.text).not.toContain("ENOENT");
    expect(JSON.parse(await readFile(f.configPath, "utf8")).resources).toEqual(
      draft.resources,
    );
    expect(
      (
        await request(
          f.origin,
          "/api/config",
          json(f.config, "PUT", await getConfigRevision(f.origin)),
        )
      ).status,
    ).toBe(200);
  });

  it("reports a workspace conflict safely and preserves protected files", async () => {
    const f = await fixture();
    const repo = createConfig(f.root).repos[0];
    const draft = { ...f.config, repos: [repo] };
    const source = path.join(
      f.config.ghqRoot,
      repo.provider,
      repo.owner,
      repo.name,
    );
    const destination = path.join(
      f.config.workspaceRoot,
      repo.category,
      repo.name,
    );
    await mkdir(source, { recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "protected-private-contents");
    const result = await request(
      f.origin,
      "/api/apply",
      json(draft, "POST", f.revision),
    );
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("WORKSPACE_SYNC_CONFLICT");
    expect(result.body.progress).toMatchObject({
      configSaved: false,
      completed: [],
      failedStage: "prepare",
    });
    expect(result.text).not.toContain(f.root);
    expect(result.text).not.toContain("protected-private-contents");
    expect(await readFile(destination, "utf8")).toBe(
      "protected-private-contents",
    );
  });

  it("never serves assets through a symlink outside the UI directory", async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, "secret.txt"), "asset-secret");
    await symlink(
      path.join(f.root, "secret.txt"),
      path.join(f.options.uiDistRoot, "leak.txt"),
    );
    const result = await request(f.origin, "/leak.txt");
    expect(result.status).toBe(403);
    expect(result.text).not.toContain("asset-secret");
    expect((await request(f.origin, "/..%2Fsecret.txt")).status).toBe(403);
  });
});
