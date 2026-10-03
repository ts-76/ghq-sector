import { spawn } from "node:child_process";
import {
  access,
  lstat,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonSchema } from "../config/build-json-schema.js";
import { loadConfig } from "../config/load-config.js";
import { normalizePortableConfig } from "../config/machine-paths.js";
import { saveConfig } from "../config/save-config.js";
import type { GhqWsConfig } from "../config/schema.js";
import { parseConfig } from "../config/validate-config.js";
import {
  hasGh,
  listGhOwnerCandidates,
  listGhRepositories,
} from "../shared/gh.js";
import { info, success } from "../shared/logger.js";
import { planWorkspace } from "../workspace/plan-workspace.js";
import { ApplyError, runApply } from "./apply.js";
import { runDoctor } from "./doctor.js";

interface EditServer {
  port: number;
  stop(closeActiveConnections?: boolean): void;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "../..");
const uiRoot = path.join(packageRoot, "ui");
const mimeTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function resolveUiDistRoot() {
  const compiledRoot = path.dirname(process.execPath);
  return [
    path.join(compiledRoot, "ui-dist"),
    path.join(packageRoot, "dist", "ui-dist"),
    path.join(uiRoot, "dist"),
  ];
}

export interface EditOptions {
  config?: string;
  host?: string;
  port?: number;
  open?: boolean;
}

export async function runEdit(options: EditOptions) {
  const host = options.host ?? "127.0.0.1";
  assertLoopbackHost(host);
  const loaded = await loadConfig(
    options.config
      ? path.resolve(process.cwd(), options.config)
      : process.cwd(),
  );
  const uiDistRoot = await ensureUiBuild();

  const port = options.port ?? 4173;
  const server = await createEditServer({
    host,
    port,
    uiDistRoot,
    configPath: loaded.path,
  });

  const editorUrl = editorOrigin(host, server.port);
  success(`edit server: ${editorUrl}`);
  info(`config path: ${loaded.path}`);
  info("press Ctrl+C to stop");

  if (options.open ?? true) {
    openBrowser(editorUrl);
  }

  await waitForShutdown(server);
}

function createRepoTemplate(config: GhqWsConfig) {
  return {
    provider: config.defaults?.provider ?? "github.com",
    owner: config.defaults?.owner ?? "",
    name: "",
    category: config.defaults?.category ?? config.categories[0] ?? "",
  };
}

export async function createEditServer(options: {
  host: string;
  port: number;
  uiDistRoot: string;
  configPath: string;
}): Promise<EditServer> {
  assertLoopbackHost(options.host);
  const configPath = await realpath(options.configPath);
  let origin = "";
  const httpServer = createServer(async (request, response) => {
    response.setHeader("content-security-policy", "frame-ancestors 'none'");
    response.setHeader("x-frame-options", "DENY");
    try {
      await handleRequest(request, response, {
        ...options,
        configPath,
        origin,
      });
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, error.status, {
          ok: false,
          code: error.code,
          message: error.message,
        });
      } else {
        sendJson(response, 500, {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "Editor operation failed",
        });
      }
    }
  });

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to determine editor server port");
  }

  origin = editorOrigin(options.host, address.port);
  return {
    port: address.port,
    stop() {
      httpServer.closeAllConnections?.();
      httpServer.close();
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: { uiDistRoot: string; configPath: string; origin: string },
) {
  const method = request.method ?? "GET";
  if (request.headers.host !== new URL(options.origin).host) {
    throw new RequestError(
      403,
      "INVALID_HOST",
      "Use the editor's displayed local address",
    );
  }
  const url = new URL(request.url ?? "/", options.origin);
  if (url.origin !== options.origin) {
    throw new RequestError(
      403,
      "INVALID_HOST",
      "Use the editor's displayed local address",
    );
  }
  if (url.pathname.startsWith("/api/")) {
    validateApiOrigin(request, options.origin);
    if (
      activeUpdates.has(options.configPath) ||
      (await fileExists(`${options.configPath}.editor-lock`))
    ) {
      throw new RequestError(
        409,
        "EDITOR_BUSY",
        "An update is in progress; retry after it completes",
      );
    }
  }
  const configDir = path.dirname(options.configPath);

  if (method === "GET" && url.pathname === "/api/config") {
    const current = await loadConfig(options.configPath);
    const content = await readFile(current.path, "utf8");
    sendJson(response, 200, {
      path: current.path,
      format: current.path.endsWith(".json") ? "json" : "yaml",
      schema: buildJsonSchema(),
      raw: content,
      value: current.config,
    });
    return;
  }

  if (method === "PUT" && url.pathname === "/api/config") {
    const payload = await readJsonBody(request);
    const config = parseApiConfig(payload);
    await withConfigUpdate(options.configPath, async () => {
      await saveConfig(options.configPath, config);
    });
    sendJson(response, 200, {
      ok: true,
      value: normalizePortableConfig(config),
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/preview") {
    const payload = await readJsonBody(request);
    const config = parseApiConfig(payload);
    const result = await planWorkspace(config, configDir);
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (method === "POST" && url.pathname === "/api/apply") {
    const payload = await readJsonBody(request);
    const config = parseApiConfig(payload);
    let reply: { status: number; body: unknown } | undefined;
    await withConfigUpdate(options.configPath, async () => {
      let configSaved = false;
      try {
        await saveConfig(options.configPath, config);
        configSaved = true;
        const result = await runApply(options.configPath);
        reply = {
          status: 200,
          body: {
            ok: true,
            message: "workspace applied",
            result,
            value: normalizePortableConfig(config),
          },
        };
      } catch (error) {
        const progress =
          error instanceof ApplyError
            ? error.progress
            : {
                completed: [],
                failedStage: configSaved ? "prepare" : "config-save",
                failedStageMayHaveChanges: !configSaved,
              };
        const conflict =
          error instanceof ApplyError &&
          error.cause instanceof Error &&
          "code" in error.cause &&
          error.cause.code === "WORKSPACE_SYNC_CONFLICT";
        reply = {
          status: conflict ? 409 : 500,
          body: {
            ok: false,
            code: conflict ? "WORKSPACE_SYNC_CONFLICT" : "APPLY_FAILED",
            message: "Apply stopped; completed changes were not rolled back.",
            progress: { configSaved, ...progress },
          },
        };
      }
    });
    if (reply) sendJson(response, reply.status, reply.body);
    return;
  }

  if (method === "GET" && url.pathname === "/api/doctor") {
    const result = await runDoctor(options.configPath);
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (method === "GET" && url.pathname === "/api/repo-template") {
    const current = await loadConfig(options.configPath);
    sendJson(response, 200, {
      ok: true,
      result: createRepoTemplate(current.config),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/gh/repos") {
    const current = await loadConfig(options.configPath);
    const ghAvailable = await hasGh();
    if (!ghAvailable) {
      sendJson(response, 200, {
        ok: true,
        available: false,
        accounts: [],
        repositories: [],
      });
      return;
    }

    const accounts = await listGhOwnerCandidates();
    const owner =
      url.searchParams.get("owner") ??
      current.config.defaults?.owner ??
      accounts.find((account) => account.active)?.login ??
      accounts[0]?.login;

    if (!owner) {
      sendJson(response, 200, {
        ok: true,
        available: true,
        accounts,
        repositories: [],
      });
      return;
    }

    const repositories = await listGhRepositories(owner);
    sendJson(response, 200, {
      ok: true,
      available: true,
      owner,
      accounts,
      repositories,
    });
    return;
  }

  if (method === "POST" && url.pathname === "/api/repos") {
    const payload = await readJsonBody(request);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      !("config" in payload)
    ) {
      throw new RequestError(
        400,
        "INVALID_CONFIG",
        "Provide the current draft config",
      );
    }
    const draft = parseApiConfig(payload.config);
    const repo = "repo" in payload ? payload.repo : createRepoTemplate(draft);
    const nextConfig = parseApiConfig({
      ...draft,
      repos: [...draft.repos, repo],
    });
    sendJson(response, 200, { ok: true, value: nextConfig });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendText(response, 404, `unknown api route: ${url.pathname}`);
    return;
  }

  await serveUiAsset(response, options.uiDistRoot, url.pathname);
}

export const MAX_EDITOR_BODY_BYTES = 1024 * 1024;
const activeUpdates = new Set<string>();

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function assertLoopbackHost(host: string) {
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new Error(
      "The editor only supports loopback hosts: 127.0.0.1, ::1, or localhost",
    );
  }
}

function editorOrigin(host: string, port: number) {
  return `http://${host === "::1" ? "[::1]" : host}:${port}`;
}

function validateApiOrigin(request: IncomingMessage, origin: string) {
  const supplied = request.headers.origin;
  const site = request.headers["sec-fetch-site"];
  if (
    (supplied !== undefined && supplied !== origin) ||
    (site !== undefined && site !== "same-origin" && site !== "none")
  ) {
    throw new RequestError(
      403,
      "INVALID_ORIGIN",
      "Use the local editor UI for this request",
    );
  }
  if (
    supplied === undefined &&
    site !== "same-origin" &&
    request.headers["x-ghq-sector-request"] !== "1"
  ) {
    throw new RequestError(
      403,
      "ORIGIN_REQUIRED",
      "Local clients without Origin must send X-Ghq-Sector-Request: 1",
    );
  }
}

function parseApiConfig(payload: unknown) {
  try {
    return parseConfig(payload);
  } catch {
    throw new RequestError(
      400,
      "INVALID_CONFIG",
      "Config does not match the schema or category rules",
    );
  }
}

async function withConfigUpdate(
  configPath: string,
  operation: () => Promise<void>,
) {
  const busy = () =>
    new RequestError(
      409,
      "EDITOR_BUSY",
      "An update is in progress; retry after it completes. A stopped editor may have left an editor-lock file.",
    );
  if (activeUpdates.has(configPath)) throw busy();
  activeUpdates.add(configPath);
  const lockPath = `${configPath}.editor-lock`;
  let lease: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try {
      lease = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw busy();
      throw error;
    }
    await lease.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    await operation();
  } finally {
    try {
      if (lease) {
        // Never remove a replacement entry; stale leases require explicit recovery.
        const owned = await lease.stat();
        await lease.close();
        const current = await lstat(lockPath).catch(() => undefined);
        if (current?.ino === owned.ino && current.dev === owned.dev) {
          await unlink(lockPath).catch(() =>
            info(
              "Editor lease cleanup failed; inspect the editor-lock file before retrying",
            ),
          );
        }
      }
    } finally {
      activeUpdates.delete(configPath);
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers["content-type"] ?? "",
    ) ||
    (request.headers["content-encoding"] !== undefined &&
      request.headers["content-encoding"] !== "identity")
  ) {
    request.resume();
    throw new RequestError(
      415,
      "JSON_REQUIRED",
      "Send application/json encoded as UTF-8",
    );
  }
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > MAX_EDITOR_BODY_BYTES) {
    request.resume();
    throw new RequestError(
      413,
      "BODY_TOO_LARGE",
      "JSON body exceeds the 1 MiB limit",
    );
  }
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const onError = () => {
      cleanup();
      reject(
        new RequestError(400, "INVALID_BODY", "Request body could not be read"),
      );
    };
    const onAborted = onError;
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_EDITOR_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(
          new RequestError(
            413,
            "BODY_TOO_LARGE",
            "JSON body exceeds the 1 MiB limit",
          ),
        );
      } else {
        chunks.push(chunk);
      }
    };
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new RequestError(
      400,
      "INVALID_JSON",
      "Body must contain valid UTF-8 JSON",
    );
  }
}

async function serveUiAsset(
  response: ServerResponse,
  uiDistRoot: string,
  pathname: string,
) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(normalizedPath);
  } catch {
    throw new RequestError(400, "INVALID_PATH", "Invalid asset path");
  }
  const filePath = path.resolve(uiDistRoot, `.${decodedPath}`);
  const relativePath = path.relative(uiDistRoot, filePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new RequestError(403, "INVALID_PATH", "Invalid asset path");
  }
  const assetPath = (await fileExists(filePath))
    ? filePath
    : path.join(uiDistRoot, "index.html");
  const resolvedAsset = await realpath(assetPath);
  const resolvedRoot = await realpath(uiDistRoot);
  const relativeAsset = path.relative(resolvedRoot, resolvedAsset);
  if (
    relativeAsset === ".." ||
    relativeAsset.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeAsset)
  ) {
    throw new RequestError(403, "INVALID_PATH", "Invalid asset path");
  }
  const content = await readFile(resolvedAsset);
  response.statusCode = 200;
  response.setHeader(
    "content-type",
    mimeTypes.get(path.extname(assetPath)) ?? "application/octet-stream",
  );
  response.end(content);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, statusCode: number, body: string) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureUiBuild() {
  for (const uiDistRoot of resolveUiDistRoot()) {
    if (await fileExists(path.join(uiDistRoot, "index.html"))) {
      return uiDistRoot;
    }
  }

  if (await canRunCommand("bun")) {
    info("ui build not found, building ui/...");
    await runCommand("bun", ["run", "build"], uiRoot);

    for (const uiDistRoot of resolveUiDistRoot()) {
      if (await fileExists(path.join(uiDistRoot, "index.html"))) {
        return uiDistRoot;
      }
    }
  }

  throw new Error(
    "ui build not found. run `bun run build` in ./ui before using `gsec edit`, or install Bun so the UI can be built automatically.",
  );
}

async function canRunCommand(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: "ignore",
      env: process.env,
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function runCommand(command: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`,
        ),
      );
    });
    child.on("error", reject);
  });
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => undefined);
  child.unref();
}

async function waitForShutdown(server: EditServer) {
  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.stop(true);
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
