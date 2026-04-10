import path from 'node:path';
import { chmod, copyFile, cp, mkdir } from 'node:fs/promises';
import type { GhqWsConfig } from '../config/schema.js';
import { expandHome } from '../shared/paths.js';

export async function copyResources(config: GhqWsConfig, cwd = process.cwd()) {
  const workspaceRoot = expandHome(config.workspaceRoot);
  const copied: string[] = [];

  for (const resource of config.resources ?? []) {
    const sourcePath = path.resolve(cwd, resource.from);
    const destinationPath = path.resolve(workspaceRoot, resource.to);

    await mkdir(path.dirname(destinationPath), { recursive: true });
    const isDirectoryTarget = resource.to === '.' || resource.to.endsWith('/');

    try {
      if (isDirectoryTarget) {
        await cp(sourcePath, destinationPath, { recursive: true, force: true });
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    } catch {
      await cp(sourcePath, destinationPath, { recursive: true, force: true });
    }

    if (resource.mode) {
      await chmod(destinationPath, Number.parseInt(resource.mode, 8));
    }

    copied.push(destinationPath);
  }

  return copied;
}
