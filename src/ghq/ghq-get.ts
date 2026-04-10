import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function ghqGet(repository: string) {
  await execFileAsync('ghq', ['get', repository]);
}
