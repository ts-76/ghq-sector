import {
  getPropertySchema,
  type JsonSchema,
  type JsonSchemaProperty,
  moveNode,
  reorderChildrenMulti,
  type TreeNode,
  type TreeState,
} from "@visual-json/core";

export const DEFAULT_CSS_VARS = {
  "--vj-bg": "#111827",
  "--vj-bg-soft": "#1f2937",
  "--vj-border": "rgba(255, 255, 255, 0.08)",
  "--vj-text": "#e5e7eb",
  "--vj-text-muted": "#9ca3af",
  "--vj-accent": "#60a5fa",
  "--vj-string": "#86efac",
  "--vj-number": "#f9a8d4",
  "--vj-boolean": "#fcd34d",
  "--vj-null": "#fca5a5",
  "--vj-key": "#c4b5fd",
  "--vj-font": "'SFMono-Regular', ui-monospace, monospace",
};

export const DIFF_COLORS = {
  added: "#10b981",
  removed: "#ef4444",
  changed: "#f59e0b",
};

export interface DragState {
  draggedNodeIds: ReadonlySet<string>;
  dropTargetNodeId: string | null;
  dropPosition: "before" | "after" | null;
}

export function INITIAL_DRAG_STATE(): DragState {
  return {
    draggedNodeIds: new Set<string>(),
    dropTargetNodeId: null,
    dropPosition: null,
  };
}

export function collectAllIds(node: TreeNode): string[] {
  return [node.id, ...node.children.flatMap((child) => collectAllIds(child))];
}

export function getVisibleNodes(
  node: TreeNode,
  isExpanded: (id: string) => boolean,
): TreeNode[] {
  const visible = [node];
  if (!isExpanded(node.id)) {
    return visible;
  }

  for (const child of node.children) {
    visible.push(...getVisibleNodes(child, isExpanded));
  }

  return visible;
}

export function getDisplayKey(node: TreeNode) {
  return node.key;
}

export function getResolvedSchema(
  schema: JsonSchema | null,
  rootSchema: JsonSchemaProperty | undefined,
  path: string,
) {
  if (!schema) {
    return undefined;
  }

  return getPropertySchema(schema, path, rootSchema);
}

export function formatValue(value: TreeNode["value"]) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
}

export function getDisplayValue(node: TreeNode) {
  if (node.type === "array") {
    return `[${node.children.length}]`;
  }

  if (node.type === "object") {
    return `{${node.children.length}}`;
  }

  if (node.type === "string") {
    return node.value ?? "";
  }

  return formatValue(node.value);
}

export function getValueColor(node: TreeNode) {
  if (node.type === "null") {
    return "var(--vj-null)";
  }

  switch (node.type) {
    case "string":
      return "var(--vj-string)";
    case "number":
      return "var(--vj-number)";
    case "boolean":
      return "var(--vj-boolean)";
    default:
      return "var(--vj-text-muted)";
  }
}

export function stripWrappingQuotes(raw: string) {
  const trimmed = raw.trim();

  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }

  return raw;
}

export function parseInputValue(
  raw: string,
  schemaType: JsonSchemaProperty["type"] | undefined,
  nodeType: TreeNode["type"],
) {
  const normalized = stripWrappingQuotes(raw);
  const resolvedType =
    typeof schemaType === "string"
      ? schemaType
      : Array.isArray(schemaType)
        ? schemaType[0]
        : undefined;
  const targetType = resolvedType ?? nodeType;

  switch (targetType) {
    case "number": {
      const parsed = Number(normalized);
      return Number.isNaN(parsed) ? normalized : parsed;
    }
    case "boolean":
      return normalized === "true";
    case "null":
      return null;
    default:
      return normalized;
  }
}

export function checkRequired(
  node: TreeNode,
  schema: JsonSchema | null,
  rootSchema: JsonSchemaProperty | undefined,
) {
  if (!node.parentId || !schema) {
    return false;
  }

  const parentPath = node.path.split("/").slice(0, -1).join("/") || "/";
  const parentSchema = getPropertySchema(schema, parentPath, rootSchema);
  return Boolean(parentSchema?.required?.includes(node.key));
}

export function setMultiDragImage(dataTransfer: DataTransfer, count: number) {
  if (typeof document === "undefined") {
    return;
  }

  const element = document.createElement("div");
  element.textContent = `${count} items`;
  element.style.position = "fixed";
  element.style.top = "-9999px";
  element.style.left = "-9999px";
  element.style.padding = "4px 8px";
  element.style.borderRadius = "6px";
  element.style.background = "#111827";
  element.style.color = "#ffffff";
  element.style.font = "12px sans-serif";
  document.body.appendChild(element);
  dataTransfer.setDragImage(element, 0, 0);
  queueMicrotask(() => element.remove());
}

export function computeDrop(
  tree: TreeState,
  dragState: DragState,
): TreeState | null {
  const targetId = dragState.dropTargetNodeId;
  const position = dragState.dropPosition;
  const draggedIds = [...dragState.draggedNodeIds];

  if (!targetId || !position || draggedIds.length === 0) {
    return null;
  }

  const target = tree.nodesById.get(targetId);
  if (!target?.parentId) {
    return null;
  }

  const sameParent = draggedIds.every(
    (id) => tree.nodesById.get(id)?.parentId === target.parentId,
  );
  if (sameParent) {
    return reorderChildrenMulti(
      tree,
      target.parentId,
      draggedIds,
      targetId,
      position,
    );
  }

  let nextTree = tree;
  for (const draggedId of draggedIds) {
    nextTree = moveNode(nextTree, draggedId, target.parentId);
  }

  return reorderChildrenMulti(
    nextTree,
    target.parentId,
    draggedIds,
    targetId,
    position,
  );
}
