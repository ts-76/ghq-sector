import * as v from "valibot";

export const hookListSchema = v.array(v.string());

export const repoSchema = v.object({
  provider: v.string(),
  owner: v.string(),
  name: v.string(),
  category: v.string(),
});

export const globalHooksSchema = v.object({
  afterInit: v.optional(hookListSchema),
  beforeClone: v.optional(hookListSchema),
  afterClone: v.optional(hookListSchema),
  afterLink: v.optional(hookListSchema),
  afterSync: v.optional(hookListSchema),
});

export const resourceSchema = v.object({
  from: v.string(),
  to: v.string(),
  mode: v.optional(v.string()),
});

export const defaultsSchema = v.object({
  provider: v.optional(v.string()),
  owner: v.optional(v.string()),
  category: v.optional(v.string()),
});

export const codeWorkspaceSchema = v.object({
  enabled: v.optional(v.boolean()),
  filename: v.optional(v.string()),
});

export const editorSchema = v.object({
  codeWorkspace: v.optional(codeWorkspaceSchema),
});

export const agentSkillsSchema = v.object({
  enabled: v.optional(v.boolean()),
  providers: v.optional(
    v.array(v.picklist(["agents", "claude"] as const)),
  ),
});

export const configSchema = v.object({
  ghqRoot: v.string(),
  workspaceRoot: v.string(),
  categories: v.array(v.string()),
  repos: v.array(repoSchema),
  hooks: v.optional(globalHooksSchema),
  resources: v.optional(v.array(resourceSchema)),
  defaults: v.optional(defaultsSchema),
  editor: v.optional(editorSchema),
  agentSkills: v.optional(agentSkillsSchema),
});

export type GhqWsConfig = v.InferOutput<typeof configSchema>;
export type GhqWsRepoConfig = v.InferOutput<typeof repoSchema>;
export type GhqWsResourceConfig = v.InferOutput<typeof resourceSchema>;
