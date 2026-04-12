import * as v from "valibot";
import { configSchema, type GhqWsConfig } from "./schema.js";

export function parseConfig(input: unknown): GhqWsConfig {
  const config = v.parse(configSchema, sanitizeConfigInput(input));
  validateConfigConsistency(config);
  return config;
}

export function validateConfigConsistency(config: GhqWsConfig) {
  const categories = new Set(config.categories);
  const invalidRepos = config.repos.filter(
    (repo) => !categories.has(repo.category),
  );

  if (invalidRepos.length === 0) {
    return;
  }

  const details = invalidRepos
    .map(
      (repo) =>
        `${repo.provider}/${repo.owner}/${repo.name} -> ${repo.category}`,
    )
    .join(", ");

  throw new Error(
    `invalid config: repo categories must exist in categories. offending repos: ${details}`,
  );
}

function sanitizeConfigInput(input: unknown) {
  return sanitizeWrappedStringsDeep(input);
}

function sanitizeWrappedStringsDeep(input: unknown): unknown {
  if (typeof input === "string") {
    return sanitizeWrappedString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeWrappedStringsDeep(item));
  }

  if (!input || typeof input !== "object") {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      sanitizeWrappedStringsDeep(value),
    ]),
  );
}

function sanitizeWrappedString(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }

  return value;
}
