import { JsonEditor } from "@visual-json/svelte";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildJsonSchema } from "../../src/config/build-json-schema.js";
import { withDraftChoices } from "../src/editor-schema.js";

let instance: ReturnType<typeof mount>;
async function settle() {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await tick();
  }
}
function row(key: string) {
  const found = [
    ...document.querySelectorAll<HTMLElement>("[data-form-node-id]"),
  ].find((element) =>
    [...element.querySelectorAll("span, input")].some(
      (span) =>
        (span instanceof HTMLInputElement
          ? span.value === key
          : span.textContent?.trim() === key) &&
        span.closest("[data-form-node-id]") === element,
    ),
  );
  if (!found)
    throw new Error(`Missing row ${key}: ${document.body.textContent}`);
  return found;
}
async function edit(key: string, value: string) {
  row(key).click();
  await settle();
  row(key)
    .closest('[role="tree"]')
    ?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  await settle();
  const inputs = row(key).querySelectorAll("input");
  const input = inputs[inputs.length - 1];
  if (!input) throw new Error(`No editor for ${key}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();
  if (document.querySelector('[role="option"]')) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
  }
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
});
afterEach(async () => {
  if (instance) await unmount(instance);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("published Visual JSON component with the local compatibility adapter", () => {
  it("retains numeric, boolean and free-form host types during keyboard editing", async () => {
    const onchange = vi.fn();
    instance = mount(JsonEditor, {
      target: document.body,
      props: {
        defaultValue: { count: 1, enabled: true, provider: "github.com" },
        sidebarOpen: false,
        onchange,
        schema: {
          type: "object",
          properties: {
            count: { type: "number" },
            enabled: { type: "boolean" },
            provider: { type: "string", examples: ["github.com"] },
          },
        },
      },
    });
    flushSync();
    await settle();
    await edit("count", "42");
    await edit("enabled", "false");
    await edit("provider", "git.private.example");
    expect(onchange).toHaveBeenLastCalledWith({
      count: 42,
      enabled: false,
      provider: "git.private.example",
    });
  });

  it("adds and removes array entries using the real form controls", async () => {
    const onchange = vi.fn();
    instance = mount(JsonEditor, {
      target: document.body,
      props: {
        defaultValue: { categories: ["work"] },
        sidebarOpen: false,
        onchange,
      },
    });
    flushSync();
    await settle();
    row("categories").dispatchEvent(new MouseEvent("mouseenter"));
    await settle();
    const add = [...row("categories").querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Add item"),
    );
    expect(add).toBeDefined();
    add?.click();
    await settle();
    expect(onchange).toHaveBeenLastCalledWith({ categories: ["work", ""] });
    const item = row("1");
    expect(item).toBeDefined();
    item?.click();
    await settle();
    item
      ?.closest('[role="tree"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    await settle();
    item?.querySelector<HTMLButtonElement>('button[title="Remove"]')?.click();
    await settle();
    expect(onchange).toHaveBeenLastCalledWith({ categories: ["work"] });
  });

  it("selects a closed enum with ArrowDown and Enter", async () => {
    const onchange = vi.fn();
    instance = mount(JsonEditor, {
      target: document.body,
      props: {
        defaultValue: { provider: "agents" },
        sidebarOpen: false,
        onchange,
        schema: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["agents", "claude"] },
          },
        },
      },
    });
    flushSync();
    await settle();
    const tree = row("provider").closest('[role="tree"]');
    tree?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle();
    tree?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    const input = row("provider").querySelectorAll("input")[1];
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(onchange).toHaveBeenLastCalledWith({ provider: "claude" });
  });
});

describe("draft schema choices", () => {
  it("keeps only the CLI's closed provider set as enum and updates free-form suggestions", () => {
    const base = buildJsonSchema();
    const schema = withDraftChoices(base, {
      categories: ["new", "new"],
      defaults: { provider: "git.private.example" },
      repos: [{ provider: "another.example" }],
    });
    expect(
      schema?.properties?.defaults?.properties?.provider?.examples,
    ).toContain("git.private.example");
    expect(
      schema?.properties?.defaults?.properties?.provider?.enum,
    ).toBeUndefined();
    expect(
      schema?.properties?.defaults?.properties?.category?.examples,
    ).toEqual(["new"]);
    const items = schema?.properties?.agentSkills?.properties?.providers?.items;
    expect(!Array.isArray(items) && items?.enum).toEqual(["agents", "claude"]);
    expect(
      base.properties?.defaults?.properties?.provider?.examples,
    ).toBeUndefined();
  });
});
