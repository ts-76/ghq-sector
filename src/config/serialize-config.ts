import YAML from "yaml";
import type { GhqWsConfig } from "./schema.js";

export function serializeConfig(configPath: string, config: GhqWsConfig) {
  return configPath.endsWith(".json")
    ? `${JSON.stringify(config, null, 2)}\n`
    : YAML.stringify(config);
}
