import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { GhqWsConfig } from './schema.js';
import { expandHome } from '../shared/paths.js';
import { serializeConfig } from './serialize-config.js';

export async function copyConfigToWorkspace(sourceConfigPath: string, config: GhqWsConfig) {
  const workspaceRoot = expandHome(config.workspaceRoot);
  const destinationPath = path.join(workspaceRoot, path.basename(sourceConfigPath));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(destinationPath, serializeConfig(sourceConfigPath, config), 'utf8');
  return destinationPath;
}
