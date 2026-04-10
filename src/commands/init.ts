import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConfigTemplate } from '../config/template.js';
import { serializeConfig, type ConfigFormat } from '../config/serialize.js';
import { DEFAULT_CATEGORIES, DEFAULT_CONFIG_BASENAME } from '../shared/constants.js';
import { listGhOwnerCandidates } from '../shared/gh.js';
import { getGhqRoot } from '../shared/ghq.js';
import { expandHome } from '../shared/paths.js';
import { info } from '../shared/logger.js';
import { runHooks } from '../hooks/run-hooks.js';
import { copyResources } from '../resources/copy-resources.js';
import { generateCodeWorkspace } from '../workspace/generate-code-workspace.js';
import { prompt, selectFromChoices } from '../shared/prompt.js';
import { runEdit } from './edit.js';

export interface InitOptions {
  ghqRoot?: string;
  workspaceRoot?: string;
  format?: ConfigFormat;
  yes?: boolean;
}

export async function runInit(options: InitOptions) {
  const ghqRoot = expandHome(options.ghqRoot ?? (options.yes ? await getGhqRoot() : await prompt('ghq root', await getGhqRoot())));
  const workspaceRoot = expandHome(
    options.workspaceRoot ??
      (options.yes
        ? '~/workspace/main'
        : await prompt('workspace root', '~/workspace/main')),
  );
  const format = options.format ?? (options.yes ? 'json' : ((await prompt('config format (json/yaml)', 'json')) === 'yaml' ? 'yaml' : 'json'));
  const owner = options.yes ? await getDefaultOwnerForYesMode() : await selectDefaultOwner();

  const config = createConfigTemplate(ghqRoot, workspaceRoot, owner ?? undefined);
  const configPath = path.join(process.cwd(), `${DEFAULT_CONFIG_BASENAME}.${format === 'json' ? 'json' : 'yaml'}`);
  const templateRoot = path.join(process.cwd(), 'workspace-template');

  await mkdir(templateRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  for (const category of DEFAULT_CATEGORIES) {
    await mkdir(path.join(templateRoot, category), { recursive: true });
    await mkdir(path.join(workspaceRoot, category), { recursive: true });
  }

  await writeFile(configPath, serializeConfig(config, format), 'utf8');
  const copiedResources = await copyResources(config, process.cwd());
  const codeWorkspacePath = await generateCodeWorkspace(config);
  await runHooks(config.hooks?.afterInit, {
    ghqRoot,
    workspaceRoot,
  });

  info(`created config: ${configPath}`);
  info(`created workspace template directories under: ${templateRoot}`);
  info(`prepared workspace root: ${workspaceRoot}`);
  if (config.defaults?.owner) {
    info(`default owner: ${config.defaults.owner}`);
  } else {
    info('default owner: not set (fill config defaults.owner later if needed)');
  }
  if (copiedResources.length > 0) {
    info(`copied resources: ${copiedResources.length}`);
  }
  if (codeWorkspacePath) {
    info(`generated code workspace: ${codeWorkspacePath}`);
  }

  if (!options.yes) {
    const openEditor = await prompt('open config editor now? (y/N)', 'N');
    if (['y', 'yes'].includes(openEditor.trim().toLowerCase())) {
      await runEdit({ config: configPath });
    }
  }
}

async function getDefaultOwnerForYesMode() {
  try {
    const candidates = await listGhOwnerCandidates();
    return candidates.find((candidate) => candidate.active)?.login ?? candidates[0]?.login ?? null;
  } catch {
    return null;
  }
}

async function selectDefaultOwner() {
  try {
    const candidates = await listGhOwnerCandidates();
    if (candidates.length === 0) {
      info('gh owner candidates: none (leave defaults.owner empty)');
      return null;
    }

    info('select default owner for shorthand clone:');
    const selection = await selectFromChoices(
      'owner choice',
      [...candidates.map((candidate) => `${candidate.login}${candidate.active ? ' (active)' : ''}`), 'skip'],
      Math.max(0, candidates.findIndex((candidate) => candidate.active)),
    );

    if (!selection || selection.index >= candidates.length) {
      return null;
    }

    return candidates[selection.index].login;
  } catch {
    info('gh owner candidates: unavailable (leave defaults.owner empty)');
    return null;
  }
}
