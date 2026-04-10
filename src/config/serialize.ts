import YAML from 'yaml';
import type { GhqWsConfig } from './schema.js';

export type ConfigFormat = 'json' | 'yaml';

export function serializeConfig(config: GhqWsConfig, format: ConfigFormat) {
  if (format === 'yaml') {
    return YAML.stringify(config);
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}
