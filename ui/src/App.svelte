<script lang="ts">
import {
  DiffView,
  JsonEditor,
  type JsonSchema,
  type JsonValue,
} from "@visual-json/svelte";
import {
  CheckCheck,
  ChevronRight,
  FolderGit2,
  Plus,
  RotateCcw,
  Save,
  Stethoscope,
} from "lucide-svelte";
import { onMount } from "svelte";
import { withDraftChoices } from "./editor-schema.js";

type ConfigFormat = "json" | "yaml";
type EditorTab = "visual" | "raw" | "diff";

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
    status: "ready" | "fetch";
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
  agentSkills: {
    enabled: boolean;
    providers: ("agents" | "claude")[];
    selected: {
      provider: "agents" | "claude";
      skillDirectoryName: string;
      destinationPath: string;
      sourcePath: string;
      repo: { label: string };
      frontmatter: { name?: string; description?: string };
    }[];
    duplicateGroups: {
      provider: "agents" | "claude";
      key: string;
      selected: { repo: { label: string } };
      skipped: { repo: { label: string } }[];
    }[];
    warnings: {
      type: "frontmatter-parse" | "missing-name";
      provider: "agents" | "claude";
      repo: string;
      skillDirectoryName: string;
      message: string;
    }[];
    summary: {
      discoveredCount: number;
      selectedCount: number;
      duplicateCount: number;
      warningCount: number;
      byProvider: Record<
        "agents" | "claude",
        {
          discoveredCount: number;
          selectedCount: number;
          duplicateCount: number;
          warningCount: number;
        }
      >;
    };
  };
  summary: {
    totalRepos: number;
    linkableRepos: number;
    missingRepos: number;
    resourcesCount: number;
    agentSkillsDiscoveredCount: number;
    agentSkillsLinkedCount: number;
    agentSkillsDuplicateCount: number;
    agentSkillsWarningCount: number;
  };
}

interface ApplyResult {
  configPath: string;
  workspaceRoot: string;
  linkedCount: number;
  skippedCount: number;
  copiedResourcesCount: number;
  codeWorkspacePath: string | null;
  agentSkills: {
    linkedCount: number;
    duplicateCount: number;
    warningCount: number;
    reports: {
      json: string;
      markdown: string;
    };
    byProvider: {
      agents: { linkedCount: number };
      claude: { linkedCount: number };
    };
  };
  copiedConfigPath: string;
  fetchedRepos: string[];
  alreadyPresentRepos: string[];
}

interface DoctorCheck {
  level: "success" | "info" | "warn";
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
let configPath = $state("");
let format = $state<ConfigFormat>("json");
let loading = $state(true);
let saving = $state(false);
let previewLoading = $state(false);
let applying = $state(false);
let doctorLoading = $state(false);

let ghReposLoading = $state(false);
let errorMessage = $state("");
let successMessage = $state("");
let previewResult = $state<PreviewResult | null>(null);
let applyResult = $state<ApplyResult | null>(null);
let appliedSnapshot = $state("");
let previewSnapshot = $state("");
let applyFailed = $state(false);
let savedConfigUnconfirmed = $state(false);
let applyProgress = $state<{
  configSaved: boolean;
  completed: string[];
  failedStage: string;
  failedStageMayHaveChanges: boolean;
} | null>(null);
let doctorResult = $state<DoctorResult | null>(null);
let rawValue = $state("");
let currentTab = $state<EditorTab>("visual");
let originalSnapshot = $state("");
let draftError = $derived.by(() => {
  if (format !== "json")
    return "YAML editing is not supported. Use the CLI to edit this file.";
  try {
    JSON.parse(rawValue);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
});
let draftValid = $derived(format === "json" && !draftError);
let unsavedChanges = $derived(serializeCurrentValue() !== originalSnapshot);
let editorSchema = $derived(withDraftChoices(schema, value));
let savedValue = $derived(
  format === "json" && originalSnapshot ? JSON.parse(originalSnapshot) : {},
);
let currentSnapshot = $derived(serializeCurrentValue());
let persistenceStatus = $derived(
  format !== "json"
    ? "Read-only YAML"
    : !draftValid
      ? "Invalid JSON"
      : saving
        ? "Saving"
        : savedConfigUnconfirmed
          ? "Saved config needs confirmation"
          : unsavedChanges
            ? "Editing (unsaved)"
            : "Saved config",
);
let workspaceStatus = $derived(
  applying
    ? "Applying"
    : applyFailed
      ? "Apply failed"
      : appliedSnapshot && appliedSnapshot === currentSnapshot
        ? "Applied"
        : "Not applied in this session",
);
let providerChoices = $derived(
  editorSchema?.properties?.defaults?.properties?.provider?.examples ?? [],
);

let draftObjectReady = $derived(
  draftValid &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value),
);
let repoChoices = $derived.by(() => {
  if (!draftObjectReady) return [];
  const config = getCurrentPayload();
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    !Array.isArray(config.repos)
  )
    return [];
  return config.repos.flatMap((repo, index) =>
    repo && typeof repo === "object" && !Array.isArray(repo)
      ? [{ index, repo }]
      : [],
  );
});
// A revision identifies an edit; the epoch identifies a loaded file/baseline.
let draftRevision = 0;
let loadEpoch = 0;
let previewRequest = 0;
let doctorRequest = 0;
let ghRequest = 0;
let ghRepos = $state<GhRepositoryCandidate[]>([]);
let ghAccounts = $state<GhAccount[]>([]);
let ghAvailable = $state(false);
let ghSelectedOwner = $state("");
let ghSelectedRepo = $state("");
let ghSelectedCategory = $state("");
let ghRepoFilter = $state("");
let selectedRepoPreview = $derived(getSelectedRepoPreview());
let previewTimer: ReturnType<typeof setTimeout> | null = null;

function extractCategories(
  source: JsonValue | Record<string, unknown> | null | undefined,
) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [] as string[];
  }

  const rawCategories = (source as { categories?: unknown }).categories;
  return Array.isArray(rawCategories)
    ? rawCategories.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];
}

const categories = $derived(
  draftValid ? extractCategories(JSON.parse(rawValue)) : [],
);
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
  if (loading || saving || applying) {
    return;
  }

  const snapshot = serializeCurrentValue();
  if (!snapshot) {
    return;
  }

  if (!draftValid) return;

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
  try {
    return serializeConfig(JSON.parse(rawValue));
  } catch {
    return rawValue;
  }
}

function getCurrentPayload() {
  if (!draftValid) throw new Error(draftError || "JSON editing is unavailable");
  return JSON.parse(rawValue) as JsonValue;
}

function getConfigObject() {
  const current = getCurrentPayload();
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("Config must be a JSON object");
  }
  return current as Record<string, unknown>;
}

function editRaw(text: string) {
  rawValue = text;
  draftRevision++;
  previewRequest++;
  previewLoading = false;
  previewResult = null;
  previewSnapshot = "";
  applyResult = null;
  successMessage = "";
  try {
    value = JSON.parse(text);
  } catch {
    /* Preserve invalid text without falling back. */
  }
}

function editVisual(next: JsonValue) {
  value = next;
  editRaw(serializeConfig(next));
}

function switchTab(tab: EditorTab) {
  if (tab !== "raw" && !draftValid) return;
  currentTab = tab;
}

async function responsePayload(response: Response) {
  const payload = await response.json();
  if (!response.ok) {
    const message =
      payload.code === "EDITOR_BUSY"
        ? "Another Save or Apply is running. Wait and try again."
        : payload.code === "WORKSPACE_SYNC_CONFLICT"
          ? "Workspace conflict: existing files or links were protected."
          : typeof payload.message === "string"
            ? payload.message
            : `Request failed (${response.status})`;
    throw Object.assign(new Error(message), {
      code: payload.code,
      progress: payload.progress,
    });
  }
  return payload;
}

function getRepoTemplate() {
  const payload = getCurrentPayload();
  const config =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const defaults =
    config.defaults && typeof config.defaults === "object"
      ? (config.defaults as Record<string, unknown>)
      : {};
  return {
    provider:
      typeof defaults.provider === "string" && defaults.provider
        ? defaults.provider
        : "github.com",
    owner: typeof defaults.owner === "string" ? defaults.owner : "",
    name: "",
    category:
      typeof defaults.category === "string" && defaults.category
        ? defaults.category
        : (categories[0] ?? ""),
  };
}

function getSelectedRepoPreview(): RepoPreview {
  if (!draftValid) return null;
  const selected = ghRepos.find(
    (repo) => repo.nameWithOwner === ghSelectedRepo,
  );
  if (!selected) {
    return null;
  }

  return {
    ...selected,
    category: categories.includes(ghSelectedCategory)
      ? ghSelectedCategory
      : getRepoTemplate().category,
  };
}

async function load() {
  const epoch = ++loadEpoch;
  const revision = draftRevision;
  previewRequest++;
  loading = true;
  errorMessage = "";
  try {
    const payload = await responsePayload(await fetch("/api/config"));
    if (epoch !== loadEpoch || revision !== draftRevision) return false;
    schema = payload.schema ?? null;
    value = payload.format === "json" ? JSON.parse(payload.raw) : payload.value;
    configPath = payload.path;
    format = payload.format;
    rawValue = payload.raw;
    originalSnapshot = format === "json" ? serializeConfig(value) : payload.raw;
    currentTab = format === "json" ? currentTab : "raw";
    applyFailed = false;
    savedConfigUnconfirmed = false;
    applyProgress = null;
    draftRevision++;
    previewResult = null;
    previewSnapshot = "";
    applyResult = null;
    appliedSnapshot = "";
    return true;
  } catch (error) {
    if (epoch === loadEpoch)
      errorMessage =
        error instanceof Error ? error.message : "failed to load config";
    return false;
  } finally {
    if (epoch === loadEpoch) loading = false;
  }
}

async function reload() {
  if (unsavedChanges && !window.confirm("Discard unsaved changes and reload?"))
    return;
  successMessage = "";
  if (!(await load())) return;
  await Promise.all([
    loadDoctor(),
    loadGhRepos(),
    previewWorkspace({ silent: true }),
  ]);
  successMessage = `reloaded ${configPath}`;
}

async function save() {
  if (!draftValid || loading || saving || applying) return;
  const payload = getCurrentPayload();
  const snapshot = serializeConfig(payload);
  const epoch = loadEpoch;
  const revision = draftRevision;
  saving = true;
  successMessage = "";
  errorMessage = "";
  try {
    const result = await responsePayload(
      await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    // The server saved this snapshot, even if a newer edit is already visible.
    if (epoch === loadEpoch) {
      originalSnapshot =
        result.value === undefined ? snapshot : serializeConfig(result.value);
      savedConfigUnconfirmed = false;
      if (revision === draftRevision) successMessage = `saved ${configPath}`;
    }
  } catch (error) {
    if (epoch === loadEpoch && revision === draftRevision)
      errorMessage =
        error instanceof Error ? error.message : "failed to save config";
  } finally {
    saving = false;
  }
}

async function previewWorkspace(options?: { silent?: boolean }) {
  if (!draftValid || loading || saving || applying) return;
  const payload = getCurrentPayload();
  const request = ++previewRequest;
  const epoch = loadEpoch;
  const revision = draftRevision;
  previewLoading = true;
  if (!options?.silent) {
    successMessage = "";
    errorMessage = "";
  }
  try {
    const result = await responsePayload(
      await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    if (
      request !== previewRequest ||
      epoch !== loadEpoch ||
      revision !== draftRevision
    )
      return;
    previewResult = result.result ?? null;
    previewSnapshot = serializeConfig(payload);
    if (!options?.silent) successMessage = "workspace plan updated";
  } catch (error) {
    if (
      request === previewRequest &&
      epoch === loadEpoch &&
      revision === draftRevision &&
      !options?.silent
    ) {
      errorMessage =
        error instanceof Error ? error.message : "failed to preview workspace";
    }
  } finally {
    if (request === previewRequest) previewLoading = false;
  }
}

async function applyWorkspace() {
  if (!draftValid || loading || saving || applying) return;
  const payload = getCurrentPayload();
  const snapshot = serializeConfig(payload);
  const epoch = loadEpoch;
  const revision = draftRevision;
  applying = true;
  applyResult = null;
  appliedSnapshot = "";
  applyFailed = false;
  applyProgress = null;
  previewRequest++;
  previewLoading = false;
  successMessage = "";
  errorMessage = "";
  try {
    const result = await responsePayload(
      await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    if (epoch !== loadEpoch) return;
    const acknowledged =
      result.value === undefined ? snapshot : serializeConfig(result.value);
    originalSnapshot = acknowledged;
    savedConfigUnconfirmed = false;
    appliedSnapshot = acknowledged;
    if (revision !== draftRevision) return;
    applyResult = result.result ?? null;
    successMessage = result.message ?? `applied ${configPath}`;
  } catch (error) {
    if (epoch === loadEpoch) {
      applyFailed = true;
      if (
        error instanceof Error &&
        "progress" in error &&
        error.progress &&
        typeof error.progress === "object"
      ) {
        const progress = error.progress as Record<string, unknown>;
        applyProgress = {
          configSaved: progress.configSaved === true,
          completed: Array.isArray(progress.completed)
            ? progress.completed.filter(
                (stage): stage is string => typeof stage === "string",
              )
            : [],
          failedStage:
            typeof progress.failedStage === "string"
              ? progress.failedStage
              : "unknown",
          failedStageMayHaveChanges:
            progress.failedStageMayHaveChanges === true,
        };
      }
      if (applyProgress?.configSaved) {
        savedConfigUnconfirmed = true;
        try {
          const saved = await responsePayload(await fetch("/api/config"));
          if (epoch === loadEpoch && saved.format === "json") {
            originalSnapshot = serializeConfig(JSON.parse(saved.raw));
            savedConfigUnconfirmed = false;
          }
        } catch {
          // Preserve the draft and show that the persisted baseline is unknown.
        }
      }
      if (epoch === loadEpoch && revision === draftRevision)
        errorMessage =
          error instanceof Error ? error.message : "failed to apply workspace";
    }
  } finally {
    applying = false;
  }
}

async function loadDoctor() {
  const request = ++doctorRequest;
  const epoch = loadEpoch;
  doctorLoading = true;

  try {
    const response = await fetch("/api/doctor");
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const payload = await response.json();
    if (request !== doctorRequest || epoch !== loadEpoch) return;
    doctorResult = payload.result ?? null;
  } catch (error) {
    if (request === doctorRequest && epoch === loadEpoch)
      errorMessage =
        error instanceof Error ? error.message : "failed to load doctor result";
  } finally {
    if (request === doctorRequest) doctorLoading = false;
  }
}

function appendRepo(repo: Record<string, unknown>, message: string) {
  if (!draftValid || loading || saving || applying) return;
  successMessage = "";
  errorMessage = "";
  try {
    const config = getConfigObject();
    if (config.repos !== undefined && !Array.isArray(config.repos))
      throw new Error("repos must be an array");
    editVisual({
      ...config,
      repos: [...((config.repos as JsonValue[]) ?? []), repo],
    } as JsonValue);
    successMessage = message;
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "failed to add repo";
  }
}

function addRepoTemplate() {
  appendRepo(getRepoTemplate(), "added repo template to draft");
}

async function loadGhRepos(ownerOverride?: string) {
  const request = ++ghRequest;
  const epoch = loadEpoch;
  ghReposLoading = true;
  ghSelectedRepo = "";
  ghRepoFilter = "";

  try {
    const owner = ownerOverride ?? ghSelectedOwner;
    const search = owner ? `?owner=${encodeURIComponent(owner)}` : "";
    const response = await fetch(`/api/gh/repos${search}`);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    const payload = (await response.json()) as GhReposPayload;
    if (request !== ghRequest || epoch !== loadEpoch) return;
    ghAvailable = payload.available;
    ghAccounts = payload.accounts ?? [];
    ghRepos = payload.repositories ?? [];
    ghSelectedOwner = payload.owner ?? owner ?? "";
    ghSelectedRepo = "";
    ghSelectedCategory = ghSelectedCategory || categories[0] || "";
  } catch (error) {
    if (request !== ghRequest || epoch !== loadEpoch) return;
    ghAvailable = false;
    ghAccounts = [];
    ghRepos = [];
    ghSelectedRepo = "";
    ghSelectedCategory = ghSelectedCategory || categories[0] || "";
    errorMessage =
      error instanceof Error ? error.message : "failed to load gh repositories";
  } finally {
    if (request === ghRequest) ghReposLoading = false;
  }
}

function addSelectedGhRepo() {
  const selected = selectedRepoPreview;
  if (!selected) return;
  appendRepo(
    {
      provider: selected.provider,
      owner: selected.owner,
      name: selected.name,
      category: selected.category,
    },
    `added ${selected.nameWithOwner} to draft`,
  );
}
function editDefault(field: "provider" | "category", text: string) {
  if (!draftObjectReady || loading || saving || applying) return;
  const config = getConfigObject();
  const defaults =
    config.defaults &&
    typeof config.defaults === "object" &&
    !Array.isArray(config.defaults)
      ? (config.defaults as Record<string, unknown>)
      : {};
  editVisual({
    ...config,
    defaults: { ...defaults, [field]: text },
  } as JsonValue);
}

function editRepoChoice(
  index: number,
  field: "provider" | "category",
  text: string,
) {
  if (!draftObjectReady || loading || saving || applying) return;
  const config = getConfigObject();
  if (!Array.isArray(config.repos)) return;
  const repos = [...config.repos];
  const repo = repos[index];
  if (!repo || typeof repo !== "object" || Array.isArray(repo)) return;
  repos[index] = { ...repo, [field]: text };
  editVisual({ ...config, repos } as JsonValue);
}

function defaultText(field: "provider" | "category") {
  if (!draftValid) return "";
  const config = getCurrentPayload();
  if (!config || typeof config !== "object" || Array.isArray(config)) return "";
  const defaults = config.defaults;
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults))
    return "";
  const text = (defaults as Record<string, unknown>)[field];
  return typeof text === "string" ? text : "";
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
        <span class:dirty={unsavedChanges} data-testid="save-status">{persistenceStatus}</span>
        <span data-testid="apply-status">{workspaceStatus}</span>
      </div>
      <button type="button" class="primary-button icon-only-button" onclick={save} disabled={!draftValid || loading || saving || applying} aria-label={saving ? 'Saving config' : 'Save config'} data-tooltip={saving ? 'Saving config' : 'Save config'}>
        <Save size={14} /><span>Save</span>
      </button>
      <button type="button" class="primary-button icon-only-button" onclick={applyWorkspace} disabled={!draftValid || loading || saving || applying} aria-label={applying ? 'Applying workspace' : 'Apply workspace'} data-tooltip={applying ? 'Applying workspace' : 'Apply workspace'}>
        <CheckCheck size={14} /><span>Apply</span>
      </button>
      <button type="button" class="ghost-button icon-only-button" onclick={reload} disabled={loading || saving || applying || doctorLoading || ghReposLoading} aria-label="Reload" data-tooltip="Reload">
        <RotateCcw size={14} />
      </button>
    </div>
  </section>

  <p class="muted operation-help">Save writes the JSON config. Apply saves it and updates the workspace.</p>
  {#if applyProgress}
    <p class="status error" role="alert">
      {applyProgress.configSaved ? 'Config was saved before Apply stopped.' : 'Config save was not completed.'}
      {#if savedConfigUnconfirmed}Saved contents could not be confirmed. Reload to check the file; your draft is retained.{/if}
      Completed: {applyProgress.completed.join(', ') || 'none'}. Stopped at: {applyProgress.failedStage}.
      {#if applyProgress.failedStageMayHaveChanges}The stopped stage may have changed files.{/if}
      Completed changes were not rolled back. Your draft is still here.
    </p>
  {/if}

  {#if draftError && !loading}
    <p class="status error" role="alert">{draftError}</p>
  {/if}

  {#if errorMessage}
    <p class="status error">{errorMessage}</p>
  {/if}

  {#if successMessage}
    <p class="status success">{successMessage}</p>
  {/if}

  <section class="workspace-shell">
    <section class="editor-shell">
      <div class="editor-header compact-header">
        <h2>{configPath ? configPath.split('/').at(-1) : 'ghq-sector config'}</h2>
        <div class="editor-tools">
          <div class="tabs segmented-tabs">
            <button type="button" class:active={currentTab === 'visual'} onclick={() => switchTab('visual')} disabled={!draftValid}>Visual</button>
            <button type="button" class:active={currentTab === 'raw'} onclick={() => switchTab('raw')}>Raw</button>
            <button type="button" class:active={currentTab === 'diff'} onclick={() => switchTab('diff')} disabled={!draftValid}>Diff</button>
          </div>
        </div>
      </div>

      {#if loading}
        <div class="placeholder editor-placeholder">Loading config...</div>
      {:else if !draftValid && currentTab !== 'raw'}
        <p class="placeholder">Return to Raw to repair the JSON. No old draft is shown.</p>
      {:else if currentTab === 'diff'}
        <section class="diff-shell" aria-label="Changes from saved config">
          {#if savedConfigUnconfirmed}<p class="muted">Diff uses the last confirmed saved config; current saved contents are unconfirmed.</p>{/if}
          <DiffView originalJson={savedValue} currentJson={value} class="config-diff" />
        </section>
      {:else if currentTab === 'raw'}
        <textarea class="raw-editor" aria-label="Raw JSON config" value={rawValue} oninput={(event) => editRaw(event.currentTarget.value)} readonly={format !== 'json'} spellcheck="false"></textarea>
      {:else if editorSchema}
        <JsonEditor
          value={value}
          onchange={editVisual}
          schema={editorSchema}
          height="min(78vh, 920px)"
          class="json-editor"
          editorShowDescriptions={true}
          treeShowCounts={false}
          editorShowCounts={false}
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
            <button type="button" class="ghost-button icon-only-button" onclick={() => previewWorkspace()} disabled={!draftValid || loading || saving || applying} aria-label={previewLoading ? 'Refreshing workspace plan' : 'Refresh workspace plan'} data-tooltip={previewLoading ? 'Refreshing workspace plan' : 'Refresh workspace plan'}>
              <RotateCcw size={14} />
            </button>
            <button type="button" class="primary-button icon-only-button" onclick={applyWorkspace} disabled={!draftValid || loading || saving || applying} aria-label={applying ? 'Applying workspace' : 'Apply workspace'} data-tooltip={applying ? 'Applying workspace' : 'Apply workspace'}>
              <CheckCheck size={14} />
            </button>
          </div>
        </div>
        <p class="muted compact-note" data-testid="preview-status">{!draftValid ? 'Preview unavailable: invalid JSON.' : previewLoading ? 'Updating plan for the current draft…' : previewResult && previewSnapshot === currentSnapshot ? 'Plan matches the current draft.' : 'Plan is out of date; refresh to compare this draft.'}</p>
        {#if previewResult && previewSnapshot === currentSnapshot}
          <dl class="kv-list compact-stats">
            <div><dt>Total repos</dt><dd>{previewResult.summary.totalRepos}</dd></div>
            <div><dt>Ready</dt><dd>{previewResult.summary.linkableRepos}</dd></div>
            <div><dt>Will fetch</dt><dd>{previewResult.summary.missingRepos}</dd></div>
            <div><dt>Resources</dt><dd>{previewResult.summary.resourcesCount}</dd></div>
            <div><dt>Skills</dt><dd>{previewResult.summary.agentSkillsLinkedCount}</dd></div>
            <div><dt>Skill duplicates</dt><dd>{previewResult.summary.agentSkillsDuplicateCount}</dd></div>
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
                <div>
                  <dt>.agents skills</dt>
                  <dd>{applyResult.agentSkills.byProvider.agents.linkedCount}</dd>
                </div>
                <div>
                  <dt>.claude skills</dt>
                  <dd>{applyResult.agentSkills.byProvider.claude.linkedCount}</dd>
                </div>
                <div>
                  <dt>Skill duplicates</dt>
                  <dd>{applyResult.agentSkills.duplicateCount}</dd>
                </div>
                <div class="field-span-2">
                  <dt>Config copy</dt>
                  <dd><code>{applyResult.copiedConfigPath}</code></dd>
                </div>
                {#if applyResult.agentSkills.byProvider.agents.linkedCount > 0 || applyResult.agentSkills.byProvider.claude.linkedCount > 0 || applyResult.agentSkills.duplicateCount > 0}
                  <div class="field-span-2">
                    <dt>Skills report</dt>
                    <dd><code>{applyResult.agentSkills.reports.markdown}</code></dd>
                  </div>
                {/if}
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
          {#if previewResult.agentSkills.enabled}
            <p class="muted compact-note">
              agent skills →
              {#if previewResult.agentSkills.providers?.includes("agents")}
                .agents {previewResult.agentSkills.summary.byProvider.agents.selectedCount}
              {/if}
              {#if previewResult.agentSkills.providers?.includes("claude")}
                {#if previewResult.agentSkills.providers?.includes("agents")}, {/if}
                .claude {previewResult.agentSkills.summary.byProvider.claude.selectedCount}
              {/if}
              , duplicates {previewResult.agentSkills.summary.duplicateCount}, warnings {previewResult.agentSkills.summary.warningCount}
            </p>
          {/if}
          {#if previewResult.codeWorkspace.enabled && previewResult.codeWorkspace.path}
            <p class="muted compact-note">code-workspace → <code>{previewResult.codeWorkspace.path}</code></p>
          {/if}
        {:else}
          <p class="muted">No workspace plan yet.</p>
        {/if}
      </section>

      <details class="panel disclosure choices-panel">
        <summary><strong>Provider and category choices</strong></summary>
        <p class="muted compact-note">Suggestions follow this draft. Custom git hosts and categories stay editable.</p>
        <label class="field-label"><span>Default provider</span>
          <input aria-label="Default provider" list="provider-choices" value={defaultText('provider')} oninput={(event) => editDefault('provider', event.currentTarget.value)} disabled={!draftObjectReady || loading || saving || applying} />
        </label>
        <datalist id="provider-choices">{#each providerChoices as provider}<option value={String(provider)}></option>{/each}</datalist>
        <label class="field-label"><span>Default category</span>
          <input aria-label="Default category" list="category-choices" value={defaultText('category')} oninput={(event) => editDefault('category', event.currentTarget.value)} disabled={!draftObjectReady || loading || saving || applying} />
        </label>
        <datalist id="category-choices">{#each categories as category}<option value={category}></option>{/each}</datalist>
        {#each repoChoices as { index, repo } (index)}
          <fieldset class="repo-choices">
            <legend>Repository {index + 1}: {String(repo.owner ?? '')}/{String(repo.name ?? '')}</legend>
            <label class="field-label"><span>Provider</span>
              <input aria-label={`Repository ${index + 1} provider`} list="provider-choices" value={typeof repo.provider === 'string' ? repo.provider : ''} oninput={(event) => editRepoChoice(index, 'provider', event.currentTarget.value)} disabled={loading || saving || applying} />
            </label>
            <label class="field-label"><span>Category</span>
              <input aria-label={`Repository ${index + 1} category`} list="category-choices" value={typeof repo.category === 'string' ? repo.category : ''} oninput={(event) => editRepoChoice(index, 'category', event.currentTarget.value)} disabled={loading || saving || applying} />
            </label>
          </fieldset>
        {/each}
      </details>

      <details class="panel disclosure">
        <summary>
          <span class="summary-label">
            <ChevronRight size={14} class="summary-chevron" />
            <Stethoscope size={14} />
            <strong>Doctor</strong>
            <small>{doctorResult?.ok ? 'Healthy' : 'Warn'}</small>
          </span>
          <button type="button" class="ghost-button inline-button icon-only-button" onclick={loadDoctor} disabled={doctorLoading || saving || applying} aria-label={doctorLoading ? 'Loading' : 'Refresh'} data-tooltip={doctorLoading ? 'Loading' : 'Refresh'}>
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
          <button type="button" class="ghost-button inline-button icon-only-button" onclick={() => loadGhRepos()} disabled={ghReposLoading || saving || applying} aria-label={ghReposLoading ? 'Loading GitHub repositories' : 'Refresh GitHub repositories'} data-tooltip={ghReposLoading ? 'Loading GitHub repositories' : 'Refresh GitHub repositories'}>
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
                disabled={!draftValid || loading || saving || applying}
                aria-label={'Add empty object'}
                data-tooltip={'Add empty object'}
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

            <button type="button" class="primary-button preset-button repo-add-button" onclick={addSelectedGhRepo} disabled={!draftValid || loading || saving || applying || ghReposLoading || !ghSelectedRepo}>
              <FolderGit2 size={14} />
              <span>Add selected repo</span>
            </button>
          {:else}
            <p class="muted">gh is not available. Only adding an empty repo template is enabled.</p>
          {/if}
        </div>
      </details>

    </aside>
  </section>
</main>
