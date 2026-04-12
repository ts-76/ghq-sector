import os from "node:os";
import path from "node:path";
import type { GhqWsConfig } from "../config/schema.js";

export interface ResolvedRuntimePaths {
  configuredGhqRoot: string;
  configuredWorkspaceRoot: string;
  resolvedGhqRoot: string;
  resolvedWorkspaceRoot: string;
}

export function expandHome(input: string) {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function collapseHome(input: string) {
  if (input === "~" || input.startsWith("~/")) {
    return input;
  }

  const resolved = path.resolve(input);
  const home = os.homedir();

  if (resolved === home) {
    return "~";
  }

  if (resolved.startsWith(`${home}${path.sep}`)) {
    return `~/${path.relative(home, resolved)}`;
  }

  return input;
}

export function remapPortableHomePath(input: string) {
  const expanded = expandHome(input);
  const home = os.homedir();

  if (expanded === home || expanded.startsWith(`${home}${path.sep}`)) {
    return expanded;
  }

  const relativeToForeignHome = getRelativePathFromForeignHome(expanded);
  if (relativeToForeignHome === null) {
    return expanded;
  }

  return relativeToForeignHome === ""
    ? home
    : path.join(home, relativeToForeignHome);
}

export function resolveRuntimePaths(
  config: GhqWsConfig,
  detectedGhqRoot?: string,
) {
  return {
    configuredGhqRoot: config.ghqRoot,
    configuredWorkspaceRoot: config.workspaceRoot,
    resolvedGhqRoot: detectedGhqRoot ?? remapPortableHomePath(config.ghqRoot),
    resolvedWorkspaceRoot: remapPortableHomePath(config.workspaceRoot),
  } satisfies ResolvedRuntimePaths;
}

export function applyResolvedRuntimePaths(
  config: GhqWsConfig,
  runtimePaths: ResolvedRuntimePaths,
): GhqWsConfig {
  if (
    config.ghqRoot === runtimePaths.resolvedGhqRoot &&
    config.workspaceRoot === runtimePaths.resolvedWorkspaceRoot
  ) {
    return config;
  }

  return {
    ...config,
    ghqRoot: runtimePaths.resolvedGhqRoot,
    workspaceRoot: runtimePaths.resolvedWorkspaceRoot,
  };
}

function getRelativePathFromForeignHome(input: string) {
  const resolved = path.resolve(input);
  const parsed = path.parse(resolved);
  const segments = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);

  if (segments[0] === "Users" || segments[0] === "home") {
    if (segments.length === 2) {
      return "";
    }

    if (segments.length > 2) {
      return path.join(...segments.slice(2));
    }
  }

  return null;
}
