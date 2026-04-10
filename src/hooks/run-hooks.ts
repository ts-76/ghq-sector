import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { HookContext } from './render-command.js';
import { renderCommand } from './render-command.js';

const execAsync = promisify(exec);

export async function runHooks(commands: string[] | undefined, context: HookContext) {
  if (!commands?.length) {
    return [];
  }

  const executed: string[] = [];

  for (const command of commands) {
    const rendered = renderCommand(command, context);
    await execAsync(rendered, {
      cwd: context.workspacePath ?? context.workspaceRoot,
    });
    executed.push(rendered);
  }

  return executed;
}
