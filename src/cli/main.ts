#!/usr/bin/env node
import { cac } from 'cac';
import { runInit } from '../commands/init.js';
import { runSync } from '../commands/sync.js';
import { runDoctor } from '../commands/doctor.js';
import { loadConfig } from '../config/load-config.js';
import { runClone } from '../commands/clone.js';
import { runEdit } from '../commands/edit.js';

const cli = cac('ghq-sector');

cli
  .command('init', 'create config template and workspace directories')
  .option('--ghq-root <path>', 'path to ghq root')
  .option('--workspace-root <path>', 'path to workspace root')
  .option('--format <format>', 'config format: json or yaml', { default: 'json' })
  .option('--yes', 'skip prompts and use defaults where needed')
  .action(async (options) => {
    const format = options.format === 'yaml' ? 'yaml' : 'json';
    await runInit({
      ghqRoot: options.ghqRoot,
      workspaceRoot: options.workspaceRoot,
      format,
      yes: Boolean(options.yes),
    });
  });

cli
  .command('sync', 'sync workspace from config')
  .action(async () => {
    await runSync();
  });

cli
  .command('clone <repository>', 'clone repository with ghq and sync workspace')
  .option('--category <name>', 'target category')
  .option('--owner <name>', 'override owner for shorthand clone')
  .option('--provider <name>', 'override provider for shorthand clone')
  .option('--yes', 'skip owner selection and use active/default account when possible')
  .action(async (repository, options) => {
    const loaded = await loadConfig();
    await runClone(loaded.config, {
      repository,
      category: options.category,
      owner: options.owner,
      provider: options.provider,
      configPath: loaded.path,
      yes: Boolean(options.yes),
    });
  });

cli
  .command('doctor', 'check environment and config')
  .action(async () => {
    await runDoctor();
  });

cli
  .command('edit', 'open config editor UI')
  .option('--config <path>', 'path to config file or directory containing it')
  .option('--host <host>', 'host to bind editor server', { default: '127.0.0.1' })
  .option('--port <port>', 'port to bind editor server', { default: '4173' })
  .option('--no-open', 'do not open browser automatically')
  .action(async (options) => {
    await runEdit({
      config: options.config,
      host: options.host,
      port: Number.parseInt(String(options.port), 10),
      open: options.open,
    });
  });

cli.help();
cli.parse();
