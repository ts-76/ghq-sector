import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";

vi.mock("@visual-json/svelte", async () => ({
  ...(await vi.importActual<typeof import("@visual-json/svelte")>(
    "@visual-json/svelte",
  )),
  JsonEditor: (await import("./JsonEditor.svelte")).default,
}));

const original = {
  categories: ["work"],
  defaults: { owner: "original" },
  repos: [],
};
const preview = {
  summary: { totalRepos: 0 },
  repoLinks: [],
  resources: [],
  codeWorkspace: { enabled: false, folders: [] },
  agentSkills: { selected: [], duplicateGroups: [], warnings: [], summary: {} },
};
const ghPayload = {
  available: true,
  owner: "alice",
  accounts: [{ login: "alice", active: true }],
  repositories: [
    {
      provider: "github.com",
      owner: "alice",
      name: "new",
      nameWithOwner: "alice/new",
      url: "https://github.com/alice/new",
      isPrivate: false,
    },
  ],
};
let instance: ReturnType<typeof mount>;
let serverValue: unknown;
let configFormat: "json" | "yaml";
let ghAvailable: boolean;
let writes: { url: string; body: unknown }[];
let putHandler: (() => Promise<Response>) | undefined;
let applyHandler: (() => Promise<Response>) | undefined;
let previewHandler: (() => Promise<Response>) | undefined;
let configHandler: (() => Promise<Response>) | undefined;
let configReads: number;

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (body: unknown, status = 200) =>
      resolve(new Response(JSON.stringify(body), { status })),
  };
}
async function settle() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await tick();
  }
}
function button(label: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find(
    (element) =>
      element.getAttribute("aria-label") === label ||
      element.textContent?.trim() === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) {
  button(label).click();
  await settle();
}
async function input(label: string, value: string) {
  const element = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing input ${label}`);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
}
function raw() {
  return (
    document.querySelector(
      '[aria-label="Raw JSON config"]',
    ) as HTMLTextAreaElement
  ).value;
}
function dirty() {
  return Boolean(document.querySelector(".badges .dirty"));
}
async function start() {
  instance = mount(App, { target: document.body });
  flushSync();
  await settle();
}

beforeEach(() => {
  serverValue = structuredClone(original);
  configFormat = "json";
  ghAvailable = false;
  writes = [];
  configReads = 0;
  putHandler = undefined;
  applyHandler = undefined;
  previewHandler = undefined;
  configHandler = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method) {
        const body = JSON.parse(options.body as string);
        writes.push({ url, body });
        if (url === "/api/config") {
          if (putHandler) return putHandler();
          serverValue = body;
          return response({ ok: true });
        }
        if (url === "/api/apply") {
          if (applyHandler) return applyHandler();
          serverValue = body;
          return response({ ok: true, message: "workspace applied" });
        }
        if (url === "/api/preview")
          return previewHandler
            ? previewHandler()
            : response({ result: preview });
        throw new Error(`Unexpected write ${url}`);
      }
      if (url === "/api/config") {
        configReads++;
        return configHandler
          ? configHandler()
          : response({
              path: "/fixture/config.json",
              format: configFormat,
              schema: {
                type: "object",
                properties: {
                  defaults: {
                    type: "object",
                    properties: {
                      provider: { type: "string" },
                      category: { type: "string" },
                    },
                  },
                  repos: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        provider: { type: "string" },
                        category: { type: "string" },
                      },
                    },
                  },
                },
              },
              value: serverValue,
              raw:
                configFormat === "yaml"
                  ? "categories: [work]\nrepos: []\n"
                  : JSON.stringify(serverValue, null, 2),
            });
      }
      if (url === "/api/doctor") return response({ result: null });
      if (url.startsWith("/api/gh/repos"))
        return response(
          ghAvailable
            ? ghPayload
            : { available: false, repositories: [], accounts: [] },
        );
      throw new Error(`Unexpected request ${url}`);
    }),
  );
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
afterEach(async () => {
  if (instance) await unmount(instance);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("JSON draft retention", () => {
  it("round trips Visual / Raw without losing either edit", async () => {
    await start();
    const visualEdit = {
      ...original,
      categories: ["visual"],
      defaults: { owner: "draft" },
    };
    await input("Visual JSON test editor", JSON.stringify(visualEdit));
    await click("Raw");
    expect(JSON.parse(raw())).toEqual(visualEdit);
    const rawEdit = { ...visualEdit, categories: ["raw"] };
    await input("Raw JSON config", JSON.stringify(rawEdit));
    await click("Visual");
    expect(
      JSON.parse(
        (
          document.querySelector(
            '[aria-label="Visual JSON test editor"]',
          ) as HTMLTextAreaElement
        ).value,
      ),
    ).toEqual(rawEdit);
    await click("Raw");
    expect(JSON.parse(raw())).toEqual(rawEdit);
  });

  it("retains invalid text and blocks visual, save, preview, apply and repo additions", async () => {
    await start();
    await click("Raw");
    writes = [];
    await input("Raw JSON config", '{"categories": [');
    for (const label of [
      "Visual",
      "Save config",
      "Refresh workspace plan",
      "Apply workspace",
      "Add empty object",
    ])
      expect(button(label).disabled).toBe(true);
    await click("Visual");
    await click("Save config");
    await click("Apply workspace");
    await new Promise((done) => setTimeout(done, 300));
    await settle();
    expect(raw()).toBe('{"categories": [');
    expect(writes).toEqual([]);
    expect(dirty()).toBe(true);
  });

  it("adds empty repos only to the current draft, keeping categories/defaults", async () => {
    await start();
    await click("Raw");
    const draft = {
      ...original,
      categories: ["draft"],
      defaults: { owner: "edited", category: "draft" },
    };
    await input("Raw JSON config", JSON.stringify(draft));
    await click("Add empty object");
    expect(JSON.parse(raw())).toEqual({
      ...draft,
      repos: [
        {
          provider: "github.com",
          owner: "edited",
          name: "",
          category: "draft",
        },
      ],
    });
    expect(serverValue).toEqual(original);
    expect(
      writes.some(
        (write) => write.url === "/api/repos" || write.url === "/api/config",
      ),
    ).toBe(false);
  });

  it("adds a GitHub preset locally without discarding raw changes", async () => {
    ghAvailable = true;
    await start();
    await click("Raw");
    const draft = {
      ...original,
      categories: ["draft"],
      defaults: { owner: "edited" },
    };
    await input("Raw JSON config", JSON.stringify(draft));
    const repository = Array.from(document.querySelectorAll("select")).find(
      (select) => select.querySelector('option[value="alice/new"]'),
    );
    if (!repository) throw new Error("Missing repository select");
    for (const option of repository.options)
      option.selected = option.value === "alice/new";
    repository.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await click("Add selected repo");
    const result = JSON.parse(raw());
    expect(result.categories).toEqual(draft.categories);
    expect(result.defaults).toEqual(draft.defaults);
    expect(result.repos[0].name).toBe("new");
    expect(result.repos[0].category).toBe("draft");
    expect(serverValue).toEqual(original);
    expect(
      writes.some(
        (write) => write.url === "/api/repos" || write.url === "/api/config",
      ),
    ).toBe(false);
  });

  it("retains invalid raw after a GitHub repo is selected without rendering the old draft", async () => {
    ghAvailable = true;
    await start();
    await click("Raw");
    const repository = Array.from(document.querySelectorAll("select")).find(
      (select) => select.querySelector('option[value="alice/new"]'),
    );
    if (!repository) throw new Error("Missing repository select");
    for (const option of repository.options)
      option.selected = option.value === "alice/new";
    repository.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await input("Raw JSON config", "{invalid");
    expect(raw()).toBe("{invalid");
    expect(button("Add selected repo").disabled).toBe(true);
    await input("Raw JSON config", "null");
    expect(raw()).toBe("null");
    await click("Add selected repo");
    expect(raw()).toBe("null");
  });

  it("uses the same valid snapshot for preview, save and apply", async () => {
    await start();
    await click("Raw");
    writes = [];
    const draft = { ...original, defaults: { owner: "shared" } };
    await input("Raw JSON config", JSON.stringify(draft));
    await click("Refresh workspace plan");
    await click("Save config");
    await click("Apply workspace");
    for (const url of ["/api/preview", "/api/config", "/api/apply"])
      expect(writes.find((write) => write.url === url)?.body).toEqual(draft);
    expect(dirty()).toBe(false);
    expect(configReads).toBe(1);
  });

  it("records the server-normalized saved baseline without rewriting the visible draft", async () => {
    await start();
    await click("Raw");
    const draft = { ...original, extra: "keep visible" };
    await input("Raw JSON config", JSON.stringify(draft));
    putHandler = () => response({ ok: true, value: original });
    await click("Save config");
    expect(JSON.parse(raw())).toEqual(draft);
    expect(dirty()).toBe(true);
    await input("Raw JSON config", JSON.stringify(original));
    expect(dirty()).toBe(false);
  });

  it("keeps baseline and draft on save/apply errors", async () => {
    await start();
    await click("Raw");
    const draft = { ...original, categories: ["draft"] };
    await input("Raw JSON config", JSON.stringify(draft));
    putHandler = () => response({ message: "write failed" }, 500);
    await click("Save config");
    expect(dirty()).toBe(true);
    expect(JSON.parse(raw())).toEqual(draft);
    expect(document.body.textContent).toContain("write failed");
    applyHandler = () =>
      response(
        { message: "Apply stopped; completed changes were not rolled back." },
        500,
      );
    await click("Apply workspace");
    expect(dirty()).toBe(true);
    expect(JSON.parse(raw())).toEqual(draft);
    expect(configReads).toBe(1);
  });

  it("prevents repeated saves and preserves newer edits when a save returns late", async () => {
    await start();
    await click("Raw");
    const first = { ...original, categories: ["first"] };
    const second = { ...original, categories: ["second"] };
    await input("Raw JSON config", JSON.stringify(first));
    const pending = deferred();
    putHandler = () => pending.promise;
    await click("Save config");
    button("Saving config").click();
    await settle();
    await input("Raw JSON config", JSON.stringify(second));
    pending.resolve({ ok: true });
    await settle();
    expect(JSON.parse(raw())).toEqual(second);
    expect(dirty()).toBe(true);
    expect(configReads).toBe(1);
    expect(writes.filter((write) => write.url === "/api/config")).toHaveLength(
      1,
    );
    // The persisted baseline is the acknowledged snapshot, rather than the newer draft.
    await input("Raw JSON config", JSON.stringify(first));
    expect(dirty()).toBe(false);
  });

  it("keeps newer edits after delayed apply and ignores stale previews", async () => {
    await start();
    await click("Raw");
    const pendingPreview = deferred();
    previewHandler = () => pendingPreview.promise;
    await click("Refresh workspace plan");
    const first = { ...original, categories: ["first"] };
    await input("Raw JSON config", JSON.stringify(first));
    const pendingApply = deferred();
    applyHandler = () => pendingApply.promise;
    await click("Apply workspace");
    const second = { ...original, categories: ["second"] };
    await input("Raw JSON config", JSON.stringify(second));
    pendingPreview.resolve({
      result: { ...preview, summary: { totalRepos: 999 } },
    });
    pendingApply.resolve({ ok: true, message: "old apply completed" });
    await settle();
    expect(JSON.parse(raw())).toEqual(second);
    expect(dirty()).toBe(true);
    expect(document.body.textContent).not.toContain("999");
    expect(document.body.textContent).not.toContain("old apply completed");
  });

  it("only discards on confirmed reload and reports read failures without losing the draft", async () => {
    await start();
    await click("Raw");
    const draft = { ...original, categories: ["draft"] };
    await input("Raw JSON config", JSON.stringify(draft));
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Reload");
    expect(configReads).toBe(1);
    expect(JSON.parse(raw())).toEqual(draft);
    vi.mocked(window.confirm).mockReturnValue(true);
    configHandler = () => response({ message: "read failed" }, 500);
    await click("Reload");
    expect(JSON.parse(raw())).toEqual(draft);
    expect(dirty()).toBe(true);
    expect(document.body.textContent).toContain("read failed");
    configHandler = undefined;
    await click("Reload");
    expect(JSON.parse(raw())).toEqual(original);
    expect(dirty()).toBe(false);
  });

  it("shows YAML read-only and does not offer implicit conversion or writes", async () => {
    configFormat = "yaml";
    await start();
    expect(raw()).toContain("categories: [work]");
    expect(
      (
        document.querySelector(
          '[aria-label="Raw JSON config"]',
        ) as HTMLTextAreaElement
      ).readOnly,
    ).toBe(true);
    for (const label of [
      "Visual",
      "Save config",
      "Apply workspace",
      "Add empty object",
    ])
      expect(button(label).disabled).toBe(true);
    expect(writes).toEqual([]);
  });
});

describe("JSON editor presentation", () => {
  it("shows added, removed, changed values in Diff and refreshes the baseline only after Save", async () => {
    await start();
    await click("Raw");
    await input(
      "Raw JSON config",
      JSON.stringify({ categories: ["changed"], repos: [], added: "new" }),
    );
    await click("Diff");
    const diff = document.querySelector(
      '[aria-label="Changes from saved config"]',
    );
    expect(diff?.textContent).toContain("added");
    expect(diff?.textContent).toContain("removed");
    expect(diff?.textContent).toContain("modified");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Not applied in this session");
    await click("Save config");
    expect(diff?.textContent).toContain("No differences detected");
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saved config");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Not applied in this session");
  });

  it("uses the saved raw JSON as the initial Visual draft and baseline", async () => {
    configHandler = () =>
      response({
        path: "/fixture/config.json",
        format: "json",
        schema: null,
        raw: JSON.stringify(original),
        value: {
          repos: [],
          defaults: original.defaults,
          categories: ["work"],
          ignoredDefault: "normalized",
        },
      });
    await start();
    await click("Raw");
    expect(JSON.parse(raw())).toEqual(original);
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saved config");
    await click("Diff");
    expect(
      document.querySelector('[aria-label="Changes from saved config"]')
        ?.textContent,
    ).toContain("No differences detected");
  });

  it("distinguishes Apply running, failed with completed stages, and successful", async () => {
    await start();
    await click("Raw");
    const draft = { ...original, categories: ["changed"] };
    await input("Raw JSON config", JSON.stringify(draft));
    const pending = deferred();
    applyHandler = () => pending.promise;
    await click("Apply workspace");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Applying");
    serverValue = draft;
    pending.resolve(
      {
        code: "WORKSPACE_SYNC_CONFLICT",
        message: "stopped",
        progress: {
          configSaved: true,
          completed: ["ensure-repos"],
          failedStage: "sync",
          failedStageMayHaveChanges: false,
        },
      },
      409,
    );
    await settle();
    expect(JSON.parse(raw())).toEqual(draft);
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Apply failed");
    expect(document.body.textContent).toContain(
      "Config was saved before Apply stopped.",
    );
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saved config");
    await click("Diff");
    expect(
      document.querySelector('[aria-label="Changes from saved config"]')
        ?.textContent,
    ).toContain("No differences detected");
    await click("Raw");
    expect(document.body.textContent).toContain("ensure-repos");
    expect(document.body.textContent).toContain(
      "existing files or links were protected",
    );
    applyHandler = () => response({ ok: true, value: draft });
    await click("Apply workspace");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Applied");
    await input("Raw JSON config", JSON.stringify(original));
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Not applied in this session");
  });

  it("confirms a partial Apply save without replacing newer edits", async () => {
    await start();
    await click("Raw");
    const sent = { ...original, categories: ["sent"] };
    const newer = { ...original, categories: ["newer"] };
    await input("Raw JSON config", JSON.stringify(sent));
    const pending = deferred();
    applyHandler = () => pending.promise;
    await click("Apply workspace");
    await input("Raw JSON config", JSON.stringify(newer));
    serverValue = sent;
    pending.resolve(
      {
        code: "APPLY_FAILED",
        progress: {
          configSaved: true,
          completed: [],
          failedStage: "sync",
          failedStageMayHaveChanges: true,
        },
      },
      500,
    );
    await settle();
    expect(JSON.parse(raw())).toEqual(newer);
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Editing (unsaved)");
    await click("Diff");
    expect(
      document.querySelector('[aria-label="Changes from saved config"]')
        ?.textContent,
    ).toContain('"sent"');
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Apply failed");
  });

  it("labels the saved baseline unconfirmed if the partial-save read fails", async () => {
    await start();
    await click("Raw");
    await input(
      "Raw JSON config",
      JSON.stringify({ ...original, categories: ["sent"] }),
    );
    configHandler = () => response({ message: "read unavailable" }, 500);
    applyHandler = () =>
      response(
        {
          code: "APPLY_FAILED",
          progress: {
            configSaved: true,
            completed: [],
            failedStage: "sync",
            failedStageMayHaveChanges: true,
          },
        },
        500,
      );
    await click("Apply workspace");
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saved config needs confirmation");
    expect(document.body.textContent).toContain(
      "Saved contents could not be confirmed",
    );
    expect(JSON.parse(raw()).categories).toEqual(["sent"]);
  });

  it("does not revive an old Applied badge after a failed retry and Reload", async () => {
    await start();
    applyHandler = () =>
      response({ ok: true, value: original, result: { linked: 5 } });
    await click("Apply workspace");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Applied");
    applyHandler = () =>
      response(
        {
          code: "APPLY_FAILED",
          progress: {
            configSaved: true,
            completed: [],
            failedStage: "sync",
            failedStageMayHaveChanges: true,
          },
        },
        500,
      );
    await click("Apply workspace");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Apply failed");
    await click("Reload");
    expect(
      document.querySelector('[data-testid="apply-status"]')?.textContent,
    ).toBe("Not applied in this session");
  });

  it("shows Saving during a retry of an unconfirmed partial save", async () => {
    await start();
    await click("Raw");
    configHandler = () => response({ message: "unavailable" }, 500);
    applyHandler = () =>
      response(
        {
          code: "APPLY_FAILED",
          progress: {
            configSaved: true,
            completed: [],
            failedStage: "sync",
            failedStageMayHaveChanges: true,
          },
        },
        500,
      );
    await click("Apply workspace");
    const pending = deferred();
    putHandler = () => pending.promise;
    await click("Save config");
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saving");
    pending.resolve({ code: "EDITOR_BUSY" }, 409);
    await settle();
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Saved config needs confirmation");
  });

  it("offers repository field suggestions while accepting custom values and preserving the draft", async () => {
    const draft = {
      ...original,
      categories: ["work", "tools"],
      repos: [
        {
          provider: "git.custom.example",
          owner: "alice",
          name: "repo",
          category: "work",
          description: "keep",
        },
      ],
    };
    serverValue = draft;
    await start();
    await click("Raw");
    expect(
      document
        .querySelector('[aria-label="Repository 1 provider"]')
        ?.getAttribute("list"),
    ).toBe("provider-choices");
    expect(
      document.querySelector(
        '#provider-choices option[value="git.custom.example"]',
      ),
    ).not.toBeNull();
    expect(
      document
        .querySelector('[aria-label="Repository 1 category"]')
        ?.getAttribute("list"),
    ).toBe("category-choices");
    await input("Repository 1 provider", "another.private.example");
    await input("Repository 1 category", "custom-category");
    expect(JSON.parse(raw()).repos).toEqual([
      {
        ...draft.repos[0],
        provider: "another.private.example",
        category: "custom-category",
      },
    ]);
    expect(JSON.parse(raw()).defaults).toEqual(original.defaults);
    expect(serverValue).toEqual(draft);
  });

  it("follows draft choices while accepting custom hosts and categories without losing edits", async () => {
    await start();
    await click("Raw");
    await input(
      "Raw JSON config",
      JSON.stringify({ ...original, categories: ["new-category"] }),
    );
    expect(
      document.querySelector("#category-choices")?.textContent,
    ).not.toContain("work");
    expect(
      document.querySelector('#category-choices option[value="new-category"]'),
    ).not.toBeNull();
    await input("Default provider", "git.private.example");
    await input("Default category", "custom-category");
    expect(JSON.parse(raw()).defaults).toEqual({
      owner: "original",
      provider: "git.private.example",
      category: "custom-category",
    });
    expect(JSON.parse(raw()).categories).toEqual(["new-category"]);
    expect(serverValue).toEqual(original);
    expect(
      document.querySelector(
        '#provider-choices option[value="git.private.example"]',
      ),
    ).not.toBeNull();
  });

  it("labels invalid JSON and hides old preview instead of showing it as current", async () => {
    await start();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="preview-status"]')?.textContent,
      ).toContain("matches the current draft"),
    );
    await click("Raw");
    await input("Raw JSON config", "{broken");
    expect(button("Diff").disabled).toBe(true);
    expect(
      document.querySelector('[data-testid="preview-status"]')?.textContent,
    ).toContain("unavailable: invalid JSON");
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Invalid JSON");
    expect(raw()).toBe("{broken");
  });

  it("keeps a busy Save response distinct from a saved config", async () => {
    await start();
    await click("Raw");
    const draft = { ...original, categories: ["draft"] };
    await input("Raw JSON config", JSON.stringify(draft));
    putHandler = () => response({ code: "EDITOR_BUSY" }, 409);
    await click("Save config");
    expect(document.body.textContent).toContain(
      "Another Save or Apply is running",
    );
    expect(
      document.querySelector('[data-testid="save-status"]')?.textContent,
    ).toBe("Editing (unsaved)");
    expect(JSON.parse(raw())).toEqual(draft);
  });
});
