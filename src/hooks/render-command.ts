export interface HookContext {
  ghqRoot: string;
  workspaceRoot: string;
  // Per-repo fields (available in beforeClone, afterClone, afterLink)
  provider?: string;
  owner?: string;
  repo?: string;
  category?: string;
  ghqPath?: string;
  workspacePath?: string;
  // Batch fields (available in afterSync)
  linkedCount?: number;
}

export function renderCommand(template: string, context: HookContext) {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, key: keyof HookContext) => {
    return String(context[key] ?? '');
  });
}
