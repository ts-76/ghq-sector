import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildJsonSchema } from "../config/build-json-schema.js";
import { loadConfig } from "../config/load-config.js";
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
import { runApply } from "./apply.js";
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
  const loaded = await loadConfig(
    options.config
      ? path.resolve(process.cwd(), options.config)
      : process.cwd(),
  );
  const uiDistRoot = await ensureUiBuild();

  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  const server = await createEditServer({
    host,
    port,
    uiDistRoot,
    configPath: loaded.path,
  });

  const editorUrl = `http://${host}:${server.port}`;
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

async function createEditServer(options: {
  host: string;
  port: number;
  uiDistRoot: string;
  configPath: string;
}): Promise<EditServer> {
  const httpServer = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, options);
    } catch (error) {
      console.error("Unhandled request error", error);
      sendJson(response, 500, { ok: false, message: "Internal server error" });
    }
  });

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
  options: { uiDistRoot: string; configPath: string },
) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
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
    const config = parseConfig(payload);
    await saveConfig(options.configPath, config);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/preview") {
    const payload = await readJsonBody(request);
    const config = parseConfig(payload);
    const result = await planWorkspace(config, configDir);
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (method === "POST" && url.pathname === "/api/apply") {
    const payload = await readJsonBody(request);
    const config = parseConfig(payload);
    await saveConfig(options.configPath, config);
    const result = await runApply(configDir);
    sendJson(response, 200, { ok: true, message: "workspace applied", result });
    return;
  }

  if (method === "GET" && url.pathname === "/api/doctor") {
    const result = await runDoctor(configDir);
    sendJson(response, 200, { ok: true, result });
    return;
  }

  if (method === "GET" && url.pathname === "/api/repo-template") {
    const current = await loadConfig(configDir);
    sendJson(response, 200, {
      ok: true,
      result: createRepoTemplate(current.config),
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/gh/repos") {
    const current = await loadConfig(configDir);
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
    const payload = (await readJsonBody(request)) as {
      repo?: Record<string, unknown>;
    };
    const current = await loadConfig(configDir);
    const currentValue = current.config as unknown as Record<string, unknown>;
    const nextRepos = Array.isArray(currentValue.repos)
      ? [...currentValue.repos]
      : [];
    nextRepos.push(payload.repo ?? createRepoTemplate(current.config));

    const nextConfig = parseConfig({
      ...currentValue,
      repos: nextRepos,
    });

    await saveConfig(current.path, nextConfig);
    sendJson(response, 200, { ok: true, value: nextConfig });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendText(response, 404, `unknown api route: ${url.pathname}`);
    return;
  }

  await serveUiAsset(response, options.uiDistRoot, url.pathname);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveUiAsset(
  response: ServerResponse,
  uiDistRoot: string,
  pathname: string,
) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(uiDistRoot, normalizedPath.replace(/^\//, ""));
  const assetPath = (await fileExists(filePath))
    ? filePath
    : path.join(uiDistRoot, "index.html");
  const content = await readFile(assetPath);
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
