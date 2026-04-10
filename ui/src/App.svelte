<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronRight, Save, Stethoscope, RotateCcw, Plus, FolderGit2, CheckCheck } from 'lucide-svelte';
  import { JsonEditor, type JsonSchema, type JsonValue } from '@visual-json/svelte';

  type ConfigFormat = 'json' | 'yaml';
  type EditorTab = 'visual' | 'raw';

  interface PreviewResult {
    ghqRoot: string;
    workspaceRoot: string;
    repoLinks: {
      provider: string;
      owner: string;
      name: string;
      category: string;
      ghqPath: string;
      workspacePath: string;
      available: boolean;
      status: 'ready' | 'fetch';
    }[];
    resources: {
      from: string;
      to: string;
      mode?: string;
    }[];
    codeWorkspace: {
      enabled: boolean;
      path: string | null;
      folders: { path: string }[];
    };
    summary: {
      totalRepos: number;
      linkableRepos: number;
      missingRepos: number;
      resourcesCount: number;
    };
  }

  interface ApplyResult {
    configPath: string;
    workspaceRoot: string;
    linkedCount: number;
    skippedCount: number;
    copiedResourcesCount: number;
    codeWorkspacePath: string | null;
    copiedConfigPath: string;
    fetchedRepos: string[];
    alreadyPresentRepos: string[];
  }

  interface DoctorCheck {
    level: 'success' | 'info' | 'warn';
    scope: string;
    message: string;
  }

  interface DoctorResult {
    ok: boolean;
    configPath: string;
    checks: DoctorCheck[];
    summary: {
      successCount: number;
      infoCount: number;
      warnCount: number;
    };
    ghqRoot: string;
    workspaceRoot: string;
    defaults: {
      provider: string | null;
      owner: string | null;
      category: string | null;
    };
    accounts: {
      login: string;
      active: boolean;
    }[];
  }

  interface GhAccount {
    login: string;
    active: boolean;
  }

  interface GhRepositoryCandidate {
    provider: string;
    owner: string;
    name: string;
    nameWithOwner: string;
    url: string;
    isPrivate: boolean;
  }

  interface GhReposPayload {
    available: boolean;
    owner?: string;
    accounts: GhAccount[];
    repositories: GhRepositoryCandidate[];
  }

  type RepoPreview = {
    provider: string;
    owner: string;
    name: string;
    nameWithOwner: string;
    url: string;
    isPrivate: boolean;
    category: string;
  } | null;

  let schema = $state<JsonSchema | null>(null);
  let value = $state<JsonValue>({});
  let configPath = $state('');
  let format = $state<ConfigFormat>('json');
  let loading = $state(true);
  let saving = $state(false);
  let previewLoading = $state(false);
  let applying = $state(false);
  let doctorLoading = $state(false);
  let addingRepo = $state(false);
  let ghReposLoading = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let previewResult = $state<PreviewResult | null>(null);
  let applyResult = $state<ApplyResult | null>(null);
  let doctorResult = $state<DoctorResult | null>(null);
  let rawValue = $state('');
  let currentTab = $state<EditorTab>('visual');
  let originalSnapshot = $state('');
  let unsavedChanges = $derived(serializeCurrentValue() !== originalSnapshot);
  let ghRepos = $state<GhRepositoryCandidate[]>([]);
  let ghAccounts = $state<GhAccount[]>([]);
  let ghAvailable = $state(false);
  let ghSelectedOwner = $state('');
  let ghSelectedRepo = $state('');
  let ghSelectedCategory = $state('');
  let ghRepoFilter = $state('');
  let selectedRepoPreview = $derived(getSelectedRepoPreview());
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  function extractCategories(source: JsonValue | Record<string, unknown> | null | undefined) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return [] as string[];
    }

    const rawCategories = (source as { categories?: unknown }).categories;
    return Array.isArray(rawCategories)
      ? rawCategories.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : [];
  }

  function getCurrentCategories() {
    if (currentTab === 'raw') {
      try {
        const parsed = parseRawValue();
        return extractCategories(parsed as JsonValue);
      } catch {
        return extractCategories(value);
      }
    }

    return extractCategories(value);
  }

  const categories = $derived(getCurrentCategories());
  const filteredGhRepos = $derived.by(() => {
    const query = ghRepoFilter.trim().toLowerCase();
    if (!query) {
      return ghRepos;
    }

    return ghRepos.filter((repo) => {
      return (
        repo.nameWithOwner.toLowerCase().includes(query) ||
        repo.name.toLowerCase().includes(query) ||
        repo.owner.toLowerCase().includes(query)
      );
    });
  });

  onMount(async () => {
    await load();
    await loadDoctor();
    await loadGhRepos();
    await previewWorkspace({ silent: true });
  });

  $effect(() => {
    if (loading || saving || applying || addingRepo) {
      return;
    }

    const snapshot = serializeCurrentValue();
    if (!snapshot) {
      return;
    }

    if (currentTab === 'raw') {
      try {
        parseRawValue();
      } catch {
        return;
      }
    }

    if (previewTimer) {
      clearTimeout(previewTimer);
    }

    previewTimer = setTimeout(() => {
      void previewWorkspace({ silent: true });
    }, 250);

    return () => {
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
    };
  });

  function serializeConfig(source: JsonValue) {
    return JSON.stringify(source, null, 2);
  }

  function serializeCurrentValue() {
    if (currentTab === 'raw') {
      try {
        return serializeConfig(parseRawValue() as JsonValue);
      } catch {
        return rawValue;
      }
    }

    return serializeConfig(value);
  }

  function getCurrentPayload() {
    return (currentTab === 'raw' ? parseRawValue() : value) as JsonValue;
  }

  function getConfigObject() {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  function getRepoTemplate() {
    const config = getConfigObject();
    const defaults = config.defaults && typeof config.defaults === 'object' ? (config.defaults as Record<string, unknown>) : {};
    return {
      provider: typeof defaults.provider === 'string' && defaults.provider ? defaults.provider : 'github.com',
      owner: typeof defaults.owner === 'string' ? defaults.owner : '',
      name: '',
      category:
        typeof defaults.category === 'string' && defaults.category
          ? defaults.category
          : categories[0] ?? '',
    };
  }

  function getSelectedRepoPreview(): RepoPreview {
    const selected = ghRepos.find((repo) => repo.nameWithOwner === ghSelectedRepo);
    if (!selected) {
      return null;
    }

    return {
      ...selected,
      category: ghSelectedCategory || getRepoTemplate().category,
    };
  }

  async function load() {
    loading = true;
    errorMessage = '';

    try {
      const response = await fetch('/api/config');
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      schema = payload.schema ?? null;
      value = payload.value;
      configPath = payload.path;
      format = payload.format;
      rawValue = payload.raw;
      originalSnapshot = serializeConfig(payload.value as JsonValue);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to load config';
    } finally {
      loading = false;
    }
  }

  async function reload() {
    successMessage = '';
    await load();
    await loadDoctor();
    await loadGhRepos();
    await previewWorkspace();
    successMessage = `reloaded ${configPath}`;
  }

  async function save() {
    saving = true;
    successMessage = '';
    errorMessage = '';

    try {
      const payload = currentTab === 'raw' ? parseRawValue() : value;
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await load();
      await loadGhRepos();
      await previewWorkspace({ silent: true });
      successMessage = `saved ${configPath}`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to save config';
    } finally {
      saving = false;
    }
  }

  async function previewWorkspace(options?: { silent?: boolean }) {
    previewLoading = true;
    if (!options?.silent) {
      successMessage = '';
      errorMessage = '';
    }

    try {
      const response = await fetch('/api/preview', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(getCurrentPayload()),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      previewResult = payload.result ?? null;
      if (!options?.silent) {
        successMessage = 'workspace plan updated';
      }
    } catch (error) {
      if (!options?.silent) {
        errorMessage = error instanceof Error ? error.message : 'failed to preview workspace';
      }
    } finally {
      previewLoading = false;
    }
  }

  async function applyWorkspace() {
    applying = true;
    successMessage = '';
    errorMessage = '';

    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(getCurrentPayload()),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = await response.json();
      applyResult = (payload.result ?? null) as ApplyResult | null;
      await load();
      await loadDoctor();
      await loadGhRepos();
      await previewWorkspace({ silent: true });
      if (applyResult) {
        successMessage = `applied workspace / fetched ${applyResult.fetchedRepos.length} / linked ${applyResult.linkedCount} / copied config`;
      } else {
        successMessage = payload.message ?? `applied ${configPath}`;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to apply workspace';
    } finally {
      applying = false;
    }
  }

  async function loadDoctor() {
    doctorLoading = true;

    try {
      const response = await fetch('/api/doctor');
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      doctorResult = payload.result ?? null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to load doctor result';
    } finally {
      doctorLoading = false;
    }
  }

  async function addRepoTemplate() {
    addingRepo = true;
    successMessage = '';
    errorMessage = '';

    try {
      const response = await fetch('/api/repos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          repo: getRepoTemplate(),
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await load();
      await previewWorkspace();
      successMessage = 'added repo template';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to add repo template';
    } finally {
      addingRepo = false;
    }
  }

  async function loadGhRepos(ownerOverride?: string) {
    ghReposLoading = true;
    ghSelectedRepo = '';
    ghRepoFilter = '';

    try {
      const owner = ownerOverride ?? ghSelectedOwner;
      const search = owner ? `?owner=${encodeURIComponent(owner)}` : '';
      const response = await fetch(`/api/gh/repos${search}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as GhReposPayload;
      ghAvailable = payload.available;
      ghAccounts = payload.accounts ?? [];
      ghRepos = payload.repositories ?? [];
      ghSelectedOwner = payload.owner ?? owner ?? '';
      ghSelectedRepo = '';
      ghSelectedCategory = ghSelectedCategory || categories[0] || '';
    } catch (error) {
      ghAvailable = false;
      ghAccounts = [];
      ghRepos = [];
      ghSelectedRepo = '';
      ghSelectedCategory = ghSelectedCategory || categories[0] || '';
      errorMessage = error instanceof Error ? error.message : 'failed to load gh repositories';
    } finally {
      ghReposLoading = false;
    }
  }

  async function addSelectedGhRepo() {
    const selectedPreview = getSelectedRepoPreview();
    if (!selectedPreview) {
      return;
    }

    const selected = ghRepos.find((repo) => repo.nameWithOwner === ghSelectedRepo);
    if (!selected) {
      return;
    }

    addingRepo = true;
    successMessage = '';
    errorMessage = '';

    try {
      const response = await fetch('/api/repos', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          repo: {
            ...getRepoTemplate(),
            provider: selected.provider,
            owner: selected.owner,
            name: selected.name,
            category: ghSelectedCategory || getRepoTemplate().category,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      await load();
      await previewWorkspace();
      successMessage = `added ${selected.nameWithOwner}`;
      ghSelectedRepo = '';
      ghSelectedCategory = ghSelectedCategory || categories[0] || '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'failed to add github repository';
    } finally {
      addingRepo = false;
    }
  }

  function parseRawValue() {
    if (format === 'json') {
      return JSON.parse(rawValue);
    }

    const trimmed = rawValue.trim();
    if (!trimmed) {
      return {};
    }

    return JSON.parse(JSON.stringify(value));
  }
</script>

<main class="app">
  <section class="topbar">
    <div class="topbar-heading">
      <h1>Config</h1>
      <code class="config-path">{configPath || 'loading...'}</code>
    </div>

    <div class="actions priority-actions">
      <div class="badges compact">
        <span>{format}</span>
        <span class:dirty={unsavedChanges}>{unsavedChanges ? 'unsaved' : 'saved'}</span>
      </div>
      <button type="button" class="primary-button icon-only-button" onclick={save} disabled={loading || saving || applying || addingRepo || previewLoading} aria-label={saving ? 'Saving config' : 'Save config'} data-tooltip={saving ? 'Saving config' : 'Save config'}>
        <Save size={14} />
      </button>
      <button type="button" class="primary-button icon-only-button" onclick={applyWorkspace} disabled={loading || saving || applying || addingRepo || previewLoading} aria-label={applying ? 'Applying workspace' : 'Apply workspace'} data-tooltip={applying ? 'Applying workspace' : 'Apply workspace'}>
        <CheckCheck size={14} />
      </button>
      <button type="button" class="ghost-button icon-only-button" onclick={reload} disabled={loading || saving || doctorLoading || ghReposLoading} aria-label="Reload" data-tooltip="Reload">
        <RotateCcw size={14} />
      </button>
    </div>
  </section>

  {#if errorMessage}
    <p class="status error">{errorMessage}</p>
  {/if}

  {#if successMessage}
    <p class="status success">{successMessage}</p>
  {/if}

  <section class="workspace-shell">
    <section class="editor-shell">
      <div class="editor-header compact-header">
        <h2>{configPath ? configPath.split('/').at(-1) : 'ghq-ws config'}</h2>
        <div class="editor-tools">
          <div class="tabs segmented-tabs">
            <button type="button" class:active={currentTab === 'visual'} onclick={() => (currentTab = 'visual')}>Visual</button>
            <button type="button" class:active={currentTab === 'raw'} onclick={() => (currentTab = 'raw')}>Raw</button>
          </div>
        </div>
      </div>

      {#if loading}
        <div class="placeholder editor-placeholder">Loading config...</div>
      {:else if currentTab === 'raw'}
        <textarea class="raw-editor" bind:value={rawValue} spellcheck="false"></textarea>
      {:else if schema}
        <JsonEditor
          value={value}
          onchange={(nextValue) => {
            value = nextValue;
          }}
          {schema}
          height="min(78vh, 920px)"
          class="json-editor"
          editorShowDescriptions={true}
          treeShowCounts={true}
          editorShowCounts={true}
        />
      {:else}
        <div class="placeholder editor-placeholder">Loading schema...</div>
      {/if}
    </section>

    <aside class="sidebar">
      <section class="panel compact-panel">
        <div class="panel-header compact-panel-header">
          <h3>Workspace plan</h3>
          <div class="inline-actions">
            <button type="button" class="ghost-button icon-only-button" onclick={previewWorkspace} disabled={loading || saving || applying || addingRepo || previewLoading} aria-label={previewLoading ? 'Refreshing workspace plan' : 'Refresh workspace plan'} data-tooltip={previewLoading ? 'Refreshing workspace plan' : 'Refresh workspace plan'}>
              <RotateCcw size={14} />
            </button>
            <button type="button" class="primary-button icon-only-button" onclick={applyWorkspace} disabled={loading || saving || applying || addingRepo || previewLoading} aria-label={applying ? 'Applying workspace' : 'Apply workspace'} data-tooltip={applying ? 'Applying workspace' : 'Apply workspace'}>
              <CheckCheck size={14} />
            </button>
          </div>
        </div>
        {#if previewResult}
          <dl class="kv-list compact-stats">
            <div><dt>Total repos</dt><dd>{previewResult.summary.totalRepos}</dd></div>
            <div><dt>Ready</dt><dd>{previewResult.summary.linkableRepos}</dd></div>
            <div><dt>Will fetch</dt><dd>{previewResult.summary.missingRepos}</dd></div>
            <div><dt>Resources</dt><dd>{previewResult.summary.resourcesCount}</dd></div>
          </dl>
          {#if applyResult}
            <div class="plan-apply-summary">
              <strong>Last apply</strong>
              <dl class="repo-preview-meta">
                <div>
                  <dt>Fetched</dt>
                  <dd>{applyResult.fetchedRepos.length}</dd>
                </div>
                <div>
                  <dt>Already present</dt>
                  <dd>{applyResult.alreadyPresentRepos.length}</dd>
                </div>
                <div>
                  <dt>Linked</dt>
                  <dd>{applyResult.linkedCount}</dd>
                </div>
                <div>
                  <dt>Skipped</dt>
                  <dd>{applyResult.skippedCount}</dd>
                </div>
                <div class="field-span-2">
                  <dt>Config copy</dt>
                  <dd><code>{applyResult.copiedConfigPath}</code></dd>
                </div>
              </dl>
            </div>
          {/if}
          <ul class="check-list compact-list plan-list">
            {#each previewResult.repoLinks.slice(0, 6) as repo}
              <li class={repo.status === 'ready' ? 'check-success' : 'check-info'}>
                <strong>{repo.category}/{repo.name}</strong>
                <small>{repo.status === 'ready' ? 'already available / ready to link' : 'will fetch via ghq get before linking'}</small>
              </li>
            {/each}
          </ul>
          {#if previewResult.repoLinks.length > 6}
            <p class="muted compact-note">+{previewResult.repoLinks.length - 6} more repos in plan</p>
          {/if}
          {#if previewResult.codeWorkspace.enabled && previewResult.codeWorkspace.path}
            <p class="muted compact-note">code-workspace → <code>{previewResult.codeWorkspace.path}</code></p>
          {/if}
        {:else}
          <p class="muted">No workspace plan yet.</p>
        {/if}
      </section>

      <details class="panel disclosure">
        <summary>
          <span class="summary-label">
            <ChevronRight size={14} class="summary-chevron" />
            <Stethoscope size={14} />
            <strong>Doctor</strong>
            <small>{doctorResult?.ok ? 'Healthy' : 'Warn'}</small>
          </span>
          <button type="button" class="ghost-button inline-button icon-only-button" onclick={loadDoctor} disabled={doctorLoading || saving || addingRepo} aria-label={doctorLoading ? 'Loading' : 'Refresh'} data-tooltip={doctorLoading ? 'Loading' : 'Refresh'}>
            <RotateCcw size={14} />
          </button>
        </summary>
        {#if doctorResult}
          <div class="doctor-summary compact-summary">
            <span>success {doctorResult.summary.successCount}</span>
            <span>info {doctorResult.summary.infoCount}</span>
            <span>warn {doctorResult.summary.warnCount}</span>
          </div>
          <ul class="check-list compact-list">
            {#each doctorResult.checks as check}
              <li class={`check-${check.level}`}><strong>{check.scope}</strong>: {check.message}</li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No doctor result.</p>
        {/if}
      </details>

      <details class="panel disclosure" open>
        <summary>
          <span class="summary-label">
            <ChevronRight size={14} class="summary-chevron" />
            <FolderGit2 size={14} />
            <strong>Repo presets</strong>
            <small>{ghAvailable ? `${ghRepos.length} repos` : 'template only'}</small>
          </span>
          <button type="button" class="ghost-button inline-button icon-only-button" onclick={() => loadGhRepos()} disabled={ghReposLoading || saving || addingRepo} aria-label={ghReposLoading ? 'Loading GitHub repositories' : 'Refresh GitHub repositories'} data-tooltip={ghReposLoading ? 'Loading GitHub repositories' : 'Refresh GitHub repositories'}>
            <RotateCcw size={14} />
          </button>
        </summary>
        <div class="repo-presets-panel">
          <div class="repo-presets-actions">
            <p class="repo-presets-hint">
              {#if ghAvailable}
                Use presets to insert complete repo objects without editing repos manually.
              {:else}
                gh is unavailable, so you can add an empty object as a fallback.
              {/if}
            </p>
            {#if !ghAvailable}
              <button
                type="button"
                class="ghost-button icon-only-button repo-template-button"
                onclick={addRepoTemplate}
                disabled={loading || saving || addingRepo}
                aria-label={addingRepo ? 'Adding empty object' : 'Add empty object'}
                data-tooltip={addingRepo ? 'Adding empty object' : 'Add empty object'}
              >
                <Plus size={14} />
              </button>
            {/if}
          </div>

          {#if ghAvailable}
            <div class="repo-preset-grid">
              <label class="field-label">
                <span>Owner</span>
                <select
                  bind:value={ghSelectedOwner}
                  onchange={(event) => {
                    ghSelectedRepo = '';
                    loadGhRepos((event.currentTarget as HTMLSelectElement).value);
                  }}
                >
                  {#each ghAccounts as account}
                    <option value={account.login}>{account.login}{account.active ? ' (active)' : ''}</option>
                  {/each}
                </select>
              </label>

              <label class="field-label">
                <span>Filter</span>
                <input bind:value={ghRepoFilter} placeholder="Filter repos" disabled={ghReposLoading} />
              </label>

              <label class="field-label field-span-2">
                <span>Repository</span>
                <select bind:value={ghSelectedRepo} disabled={ghReposLoading}>
                  <option value="">{ghReposLoading ? 'Loading repositories…' : 'Select repository'}</option>
                  {#each filteredGhRepos as repo}
                    <option value={repo.nameWithOwner}>{repo.nameWithOwner}{repo.isPrivate ? ' • private' : ''}</option>
                  {/each}
                </select>
              </label>

              <label class="field-label">
                <span>Category</span>
                <select bind:value={ghSelectedCategory} disabled={categories.length === 0}>
                  {#if categories.length === 0}
                    <option value="">No categories</option>
                  {:else}
                    {#each categories as category}
                      <option value={category}>{category}</option>
                    {/each}
                  {/if}
                </select>
              </label>

              <div class="repo-preview field-span-2">
                {#if selectedRepoPreview}
                  <div class="repo-preview-header">
                    <strong>{selectedRepoPreview.nameWithOwner}</strong>
                    <span class:private-badge={selectedRepoPreview.isPrivate}>{selectedRepoPreview.isPrivate ? 'private' : 'public'}</span>
                  </div>
                  <dl class="repo-preview-meta">
                    <div>
                      <dt>Provider</dt>
                      <dd>{selectedRepoPreview.provider}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{selectedRepoPreview.category || '—'}</dd>
                    </div>
                    <div class="field-span-2">
                      <dt>URL</dt>
                      <dd><code>{selectedRepoPreview.url}</code></dd>
                    </div>
                  </dl>
                {:else if ghReposLoading}
                  <span>Loading repositories for {ghSelectedOwner || 'selected owner'}…</span>
                {:else if ghRepoFilter && filteredGhRepos.length === 0}
                  <span>No repositories matched “{ghRepoFilter}”.</span>
                {:else}
                  <span>Select a repository to add it as a preset.</span>
                {/if}
              </div>
            </div>

            <button type="button" class="primary-button preset-button repo-add-button" onclick={addSelectedGhRepo} disabled={addingRepo || ghReposLoading || !ghSelectedRepo}>
              <FolderGit2 size={14} />
              <span>{addingRepo ? 'Adding…' : 'Add selected repo'}</span>
            </button>
          {:else}
            <p class="muted">gh が使えないので、空の repo テンプレート追加のみ有効です。</p>
          {/if}
        </div>
      </details>

    </aside>
  </section>
</main>
