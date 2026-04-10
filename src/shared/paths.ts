import os from 'node:os';
import path from 'node:path';

export function expandHome(input: string) {
  if (input === '~') {
    return os.homedir();
  }

  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}
