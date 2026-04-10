import path from 'node:path';
import { mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { GhqWsConfig } from '../src/config/schema.js';
import { createConfig, importFresh, makeTempRoot } from './helpers.js';

describe('apply workflow', () => {
  it('returns fetched/already-present repos and sync/copy results via runApply', async () => {
    const config = createConfig('/tmp/project');

    const loadConfig = vi.fn(async () => ({ path: '/tmp/project/ghq-ws.config.json', config }));
    const ensureRepos = vi.fn(async () => ({
      fetched: ['github.com/ts-76/dotfiles'],
      alreadyPresent: ['github.com/ts-76/life'],
    }));
    const runSync = vi.fn(async () => ({
      configPath: '/tmp/project/ghq-ws.config.json',
      workspaceRoot: '/tmp/project/workspace',
      linkedCount: 2,
      skippedCount: 1,
      copiedResourcesCount: 3,
      codeWorkspacePath: '/tmp/project/workspace/main.code-workspace',
    }));
    const copyConfigToWorkspace = vi.fn(async () => '/tmp/project/workspace/ghq-ws.config.json');

    vi.doMock('../src/config/load-config.js', () => ({ loadConfig }));
    vi.doMock('../src/ghq/ensure-repos.js', () => ({ ensureRepos }));
    vi.doMock('../src/commands/sync.js', () => ({ runSync }));
    vi.doMock('../src/config/copy-config-to-workspace.js', () => ({ copyConfigToWorkspace }));

    const { runApply } = await importFresh<typeof import('../src/commands/apply.js')>('../src/commands/apply.js');
    const result = await runApply('/tmp/project');

    expect(loadConfig).toHaveBeenCalledWith('/tmp/project');
    expect(ensureRepos).toHaveBeenCalledWith(config);
    expect(runSync).toHaveBeenCalledWith('/tmp/project');
    expect(copyConfigToWorkspace).toHaveBeenCalledWith('/tmp/project/ghq-ws.config.json', config);
    expect(result).toEqual({
      configPath: '/tmp/project/ghq-ws.config.json',
      workspaceRoot: '/tmp/project/workspace',
      linkedCount: 2,
      skippedCount: 1,
      copiedResourcesCount: 3,
      codeWorkspacePath: '/tmp/project/workspace/main.code-workspace',
      copiedConfigPath: '/tmp/project/workspace/ghq-ws.config.json',
      fetchedRepos: ['github.com/ts-76/dotfiles'],
      alreadyPresentRepos: ['github.com/ts-76/life'],
    });
  });

  it('ghq gets only missing repos in ensureRepos and runs clone hooks around them', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const presentSource = path.join(config.ghqRoot, 'github.com', 'ts-76', 'life');

    await mkdir(presentSource, { recursive: true });

    const callOrder: string[] = [];
    const hookCalls: Array<{ commands: string[] | undefined; context: Record<string, unknown> }> = [];
    const ghqGetCalls: string[] = [];

    vi.doMock('../src/hooks/run-hooks.js', () => ({
      runHooks: vi.fn(async (commands: string[] | undefined, context: Record<string, unknown>) => {
        if (commands?.includes('before-clone')) callOrder.push('beforeClone');
        if (commands?.includes('after-clone')) callOrder.push('afterClone');
        hookCalls.push({ commands, context });
        return [];
      }),
    }));

    vi.doMock('../src/ghq/ghq-get.js', () => ({
      ghqGet: vi.fn(async (repository: string) => {
        callOrder.push('ghqGet');
        ghqGetCalls.push(repository);
        await mkdir(path.join(config.ghqRoot, repository), { recursive: true });
      }),
    }));

    const { ensureRepos } = await importFresh<typeof import('../src/ghq/ensure-repos.js')>('../src/ghq/ensure-repos.js');

    config.hooks = {
      beforeClone: ['before-clone'],
      afterClone: ['after-clone'],
      afterInit: [],
      afterLink: [],
      afterSync: [],
    };

    const result = await ensureRepos(config);

    expect(result).toEqual({
      fetched: ['github.com/ts-76/dotfiles'],
      alreadyPresent: ['github.com/ts-76/life'],
    });
    expect(ghqGetCalls).toEqual(['github.com/ts-76/dotfiles']);
    expect(callOrder).toEqual(['beforeClone', 'ghqGet', 'afterClone']);
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0]).toMatchObject({
      commands: ['before-clone'],
      context: {
        provider: 'github.com',
        owner: 'ts-76',
        repo: 'dotfiles',
        category: 'tools',
        ghqRoot: config.ghqRoot,
        workspaceRoot: config.workspaceRoot,
        ghqPath: path.join(config.ghqRoot, 'github.com', 'ts-76', 'dotfiles'),
        workspacePath: path.join(config.workspaceRoot, 'tools', 'dotfiles'),
      },
    });
    expect(hookCalls[1]).toMatchObject({
      commands: ['after-clone'],
      context: {
        repo: 'dotfiles',
      },
    });
  });

  it('propagates ghq get failures from ensureRepos', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const presentSource = path.join(config.ghqRoot, 'github.com', 'ts-76', 'life');

    await mkdir(presentSource, { recursive: true });

    vi.doMock('../src/hooks/run-hooks.js', () => ({
      runHooks: vi.fn(async () => []),
    }));

    vi.doMock('../src/ghq/ghq-get.js', () => ({
      ghqGet: vi.fn(async () => {
        throw new Error('ghq get failed');
      }),
    }));

    const { ensureRepos } = await importFresh<typeof import('../src/ghq/ensure-repos.js')>('../src/ghq/ensure-repos.js');

    await expect(ensureRepos(config)).rejects.toThrow('ghq get failed');
  });

  it('stops runApply when ensureRepos fails before sync/copy', async () => {
    const config = createConfig('/tmp/project');
    const loadConfig = vi.fn(async () => ({ path: '/tmp/project/ghq-ws.config.json', config }));
    const ensureRepos = vi.fn(async () => {
      throw new Error('ensure failed');
    });
    const runSync = vi.fn(async () => ({
      configPath: '/tmp/project/ghq-ws.config.json',
      workspaceRoot: '/tmp/project/workspace',
      linkedCount: 0,
      skippedCount: 0,
      copiedResourcesCount: 0,
      codeWorkspacePath: null,
    }));
    const copyConfigToWorkspace = vi.fn(async () => '/tmp/project/workspace/ghq-ws.config.json');

    vi.doMock('../src/config/load-config.js', () => ({ loadConfig }));
    vi.doMock('../src/ghq/ensure-repos.js', () => ({ ensureRepos }));
    vi.doMock('../src/commands/sync.js', () => ({ runSync }));
    vi.doMock('../src/config/copy-config-to-workspace.js', () => ({ copyConfigToWorkspace }));

    const { runApply } = await importFresh<typeof import('../src/commands/apply.js')>('../src/commands/apply.js');

    await expect(runApply('/tmp/project')).rejects.toThrow('ensure failed');
    expect(runSync).not.toHaveBeenCalled();
    expect(copyConfigToWorkspace).not.toHaveBeenCalled();
  });

  it('generates .code-workspace content and copies resources/config into workspace', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const cwd = path.join(root, 'config-home');
    const sourceConfigPath = path.join(cwd, 'ghq-ws.config.json');

    await mkdir(cwd, { recursive: true });
    await mkdir(config.workspaceRoot, { recursive: true });
    await writeFile(path.join(cwd, 'notes.md'), '# notes\n', 'utf8');
    await writeFile(sourceConfigPath, JSON.stringify(config, null, 2), 'utf8');

    config.resources = [{ from: 'notes.md', to: 'docs/notes.md' }];

    const { copyResources } = await importFresh<typeof import('../src/resources/copy-resources.js')>('../src/resources/copy-resources.js');
    const { generateCodeWorkspace } = await importFresh<typeof import('../src/workspace/generate-code-workspace.js')>('../src/workspace/generate-code-workspace.js');
    const { copyConfigToWorkspace } = await importFresh<typeof import('../src/config/copy-config-to-workspace.js')>('../src/config/copy-config-to-workspace.js');

    const copiedResources = await copyResources(config, cwd);
    const workspaceFilePath = await generateCodeWorkspace(config);
    const copiedConfigPath = await copyConfigToWorkspace(sourceConfigPath, config);

    expect(copiedResources).toEqual([path.join(config.workspaceRoot, 'docs', 'notes.md')]);
    expect(await readFile(copiedResources[0], 'utf8')).toBe('# notes\n');
    expect(workspaceFilePath).toBe(path.join(config.workspaceRoot, 'main.code-workspace'));
    expect(JSON.parse(await readFile(workspaceFilePath!, 'utf8'))).toEqual({
      folders: [{ path: 'projects/life' }, { path: 'tools/dotfiles' }],
      settings: {
        'files.exclude': {
          '**/.git': true,
          '**/.DS_Store': true,
        },
      },
    });
    expect(copiedConfigPath).toBe(path.join(config.workspaceRoot, 'ghq-ws.config.json'));
    expect(JSON.parse(await readFile(copiedConfigPath, 'utf8'))).toEqual(config);
  });

});

describe('clone workflow', () => {
  function setupCloneMocks(root: string) {
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');
    const savedConfigs: GhqWsConfig[] = [];
    const ghqGetCalls: string[] = [];
    const hookCalls: Array<{ commands: string[] | undefined; context: Record<string, unknown> }> = [];

    vi.doMock('../src/config/save-config.js', () => ({
      saveConfig: vi.fn(async (_configPath: string, nextConfig: GhqWsConfig) => {
        savedConfigs.push(nextConfig);
      }),
    }));
    vi.doMock('../src/ghq/ghq-get.js', () => ({
      ghqGet: vi.fn(async (repository: string) => {
        ghqGetCalls.push(repository);
        await mkdir(path.join(config.ghqRoot, repository), { recursive: true });
      }),
    }));
    vi.doMock('../src/hooks/run-hooks.js', () => ({
      runHooks: vi.fn(async (commands: string[] | undefined, context: Record<string, unknown>) => {
        hookCalls.push({ commands, context });
        return [];
      }),
    }));
    vi.doMock('../src/resources/copy-resources.js', () => ({
      copyResources: vi.fn(async () => ['/tmp/resource']),
    }));
    vi.doMock('../src/workspace/generate-code-workspace.js', () => ({
      generateCodeWorkspace: vi.fn(async () => path.join(config.workspaceRoot, 'main.code-workspace')),
    }));
    vi.doMock('../src/workspace/sync-workspace.js', () => ({
      syncWorkspace: vi.fn(async (nextConfig: GhqWsConfig) => ({
        workspaceRoot: nextConfig.workspaceRoot,
        linked: nextConfig.repos.map((repo) => ({ repo, destinationPath: path.join(nextConfig.workspaceRoot, repo.category, repo.name) })),
        skipped: [],
      })),
    }));

    return { config, configPath, savedConfigs, ghqGetCalls, hookCalls };
  }

  it('parses provider/owner/name repositories and upserts config', async () => {
    const root = await makeTempRoot();
    const { config, configPath, savedConfigs, ghqGetCalls, hookCalls } = setupCloneMocks(root);
    config.repos = [
      {
        provider: 'github.com',
        owner: 'ts-76',
        name: 'life',
        category: 'docs',
      },
    ];

    const { runClone } = await importFresh<typeof import('../src/commands/clone.js')>('../src/commands/clone.js');
    const result = await runClone(config, {
      repository: 'github.enterprise.local/infra/toolbox',
      configPath,
      category: 'tools',
      yes: true,
    });

    expect(result.repo).toEqual({
      provider: 'github.enterprise.local',
      owner: 'infra',
      name: 'toolbox',
      category: 'tools',
    });
    expect(result.repositoryPath).toBe('github.enterprise.local/infra/toolbox');
    expect(ghqGetCalls).toEqual(['github.enterprise.local/infra/toolbox']);
    expect(savedConfigs).toHaveLength(1);
    expect(savedConfigs[0].repos).toContainEqual({
      provider: 'github.enterprise.local',
      owner: 'infra',
      name: 'toolbox',
      category: 'tools',
    });
    expect(hookCalls).toHaveLength(2);
  });

  it('parses owner/name repositories with default provider', async () => {
    const root = await makeTempRoot();
    const { config, configPath } = setupCloneMocks(root);

    const { runClone } = await importFresh<typeof import('../src/commands/clone.js')>('../src/commands/clone.js');
    const result = await runClone(config, {
      repository: 'labelmake/ghq-ws',
      configPath,
      yes: true,
    });

    expect(result.repo).toEqual({
      provider: 'github.com',
      owner: 'labelmake',
      name: 'ghq-ws',
      category: 'projects',
    });
  });

  it('parses shorthand name repositories with defaults.owner', async () => {
    const root = await makeTempRoot();
    const { config, configPath } = setupCloneMocks(root);

    const { runClone } = await importFresh<typeof import('../src/commands/clone.js')>('../src/commands/clone.js');
    const result = await runClone(config, {
      repository: 'life',
      configPath,
      yes: true,
    });

    expect(result.repo).toEqual({
      provider: 'github.com',
      owner: 'ts-76',
      name: 'life',
      category: 'projects',
    });
  });

  it('uses interactive owner resolution for shorthand clones when defaults.owner is missing', async () => {
    const root = await makeTempRoot();
    const { config, configPath } = setupCloneMocks(root);
    config.defaults = {
      provider: 'github.com',
      category: 'projects',
    };

    vi.doMock('../src/shared/gh.js', () => ({
      resolveOwner: vi.fn(async () => ({
        candidates: [
          { login: 'ts-76', active: true },
          { login: 'labelmake', active: false },
        ],
        defaultIndex: 0,
      })),
    }));
    vi.doMock('../src/shared/prompt.js', () => ({
      selectFromChoices: vi.fn(async () => ({ index: 1, value: 'labelmake' })),
    }));

    const { runClone } = await importFresh<typeof import('../src/commands/clone.js')>('../src/commands/clone.js');
    const result = await runClone(config, {
      repository: 'workspace',
      configPath,
    });

    expect(result.repo.owner).toBe('labelmake');
    expect(result.repositoryPath).toBe('github.com/labelmake/workspace');
  });

  it('fails shorthand clones when owner cannot be resolved', async () => {
    const root = await makeTempRoot();
    const { config, configPath } = setupCloneMocks(root);
    config.defaults = {
      provider: 'github.com',
      category: 'projects',
    };

    vi.doMock('../src/shared/gh.js', () => ({
      resolveOwner: vi.fn(async () => null),
    }));

    const { runClone } = await importFresh<typeof import('../src/commands/clone.js')>('../src/commands/clone.js');

    await expect(
      runClone(config, {
        repository: 'workspace',
        configPath,
        yes: true,
      }),
    ).rejects.toThrow('repository must be provider/owner/name, owner/name, or name with defaults.owner, --owner, or gh account selection');
  });
});

describe('doctor diagnostics', () => {
  async function importDoctorWithCommandMocks(
    config: GhqWsConfig,
    configPath: string,
    detectedGhqRoot: string,
    options?: {
      hasGhq?: boolean;
      hasGh?: boolean;
      ownerCandidates?: { login: string; active: boolean }[];
    },
  ) {
    vi.doMock('../src/shared/ghq.js', () => ({
      hasGhq: vi.fn(async () => options?.hasGhq ?? true),
      getGhqRoot: vi.fn(async () => detectedGhqRoot),
    }));
    vi.doMock('../src/shared/gh.js', () => ({
      hasGh: vi.fn(async () => options?.hasGh ?? true),
      listGhOwnerCandidates: vi.fn(async () => options?.ownerCandidates ?? [{ login: 'ts-76', active: true }]),
    }));
    vi.doMock('../src/config/load-config.js', () => ({
      loadConfig: vi.fn(async () => ({ path: configPath, config })),
    }));

    return importFresh<typeof import('../src/commands/doctor.js')>('../src/commands/doctor.js');
  }

  it('throws when ghq command is unavailable', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');

    const { runDoctor } = await importDoctorWithCommandMocks(config, configPath, config.ghqRoot, { hasGhq: false });

    await expect(runDoctor(root)).rejects.toThrow('ghq command is not available');
  });

  it('throws when gh command is unavailable', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');

    const { runDoctor } = await importDoctorWithCommandMocks(config, configPath, config.ghqRoot, { hasGh: false });

    await expect(runDoctor(root)).rejects.toThrow('gh command is not available');
  });

  it('skips workspace-side checks when workspace root does not exist yet', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');
    const detectedGhqRoot = config.ghqRoot;

    await mkdir(path.join(detectedGhqRoot, 'github.com', 'ts-76', 'life'), { recursive: true });

    const { runDoctor } = await importDoctorWithCommandMocks(config, configPath, detectedGhqRoot);
    const result = await runDoctor(root);

    expect(result.ghqRoot).toBe(detectedGhqRoot);
    expect(result.workspaceRoot).toBe(config.workspaceRoot);
    expect(result.checks.some((check) => check.scope === 'workspace checks' && check.message.includes('skipped'))).toBe(true);
    expect(result.checks.some((check) => check.scope === 'code workspace')).toBe(false);
    expect(result.checks.some((check) => check.scope === 'repo github.com/ts-76/life' && check.message.includes('missing link'))).toBe(false);
  });

  it('reports missing repo sources before workspace exists', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');

    const { runDoctor } = await importDoctorWithCommandMocks(config, configPath, config.ghqRoot);
    const result = await runDoctor(root);

    expect(result.checks.some((check) => check.scope === 'repo github.com/ts-76/life' && check.message.includes('missing source'))).toBe(true);
    expect(result.checks.some((check) => check.scope === 'repo github.com/ts-76/dotfiles' && check.message.includes('missing source'))).toBe(true);
  });

  it('reports code workspace and symlink status when workspace exists', async () => {
    const root = await makeTempRoot();
    const config = createConfig(root);
    const configPath = path.join(root, 'ghq-ws.config.json');
    const detectedGhqRoot = config.ghqRoot;
    const source = path.join(detectedGhqRoot, 'github.com', 'ts-76', 'life');
    const destination = path.join(config.workspaceRoot, 'projects', 'life');

    await mkdir(source, { recursive: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await mkdir(config.workspaceRoot, { recursive: true });
    await symlink(source, destination);
    await writeFile(path.join(config.workspaceRoot, 'main.code-workspace'), '{}\n', 'utf8');

    const { runDoctor } = await importDoctorWithCommandMocks(config, configPath, detectedGhqRoot);
    const result = await runDoctor(root);

    expect(result.checks.some((check) => check.scope === 'code workspace' && check.level === 'success')).toBe(true);
    expect(result.checks.some((check) => check.scope === 'repo github.com/ts-76/life' && check.message.includes('link ok'))).toBe(true);
  });
});
