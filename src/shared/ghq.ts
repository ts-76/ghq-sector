import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expandHome } from './paths.js';

const execFileAsync = promisify(execFile);

export async function getGhqRoot() {
  const { stdout } = await execFileAsync('ghq', ['root']);
  return expandHome(stdout.trim());
}

export async function hasGhq() {
  try {
    await getGhqRoot();
    return true;
  } catch {
    return false;
  }
}
