import * as v from 'valibot';
import { configSchema, type GhqWsConfig } from './schema.js';

export function parseConfig(input: unknown): GhqWsConfig {
  const config = v.parse(configSchema, input);
  validateConfigConsistency(config);
  return config;
}

export function validateConfigConsistency(config: GhqWsConfig) {
  const categories = new Set(config.categories);
  const invalidRepos = config.repos.filter((repo) => !categories.has(repo.category));

  if (invalidRepos.length === 0) {
    return;
  }

  const details = invalidRepos
    .map((repo) => `${repo.provider}/${repo.owner}/${repo.name} -> ${repo.category}`)
    .join(', ');

  throw new Error(
    `invalid config: repo categories must exist in categories. offending repos: ${details}`,
  );
}
