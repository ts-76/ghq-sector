import { DEFAULT_CATEGORIES } from "../shared/constants.js";
import type { GhqWsConfig } from "./schema.js";

export function createConfigTemplate(
  ghqRoot: string,
  workspaceRoot: string,
  owner?: string,
): GhqWsConfig {
  return {
    ghqRoot,
    workspaceRoot,
    categories: [...DEFAULT_CATEGORIES],
    repos: [],
    hooks: {
      afterInit: [],
      beforeClone: [],
      afterClone: [],
      afterLink: [],
      afterSync: [],
    },
    resources: [],
    defaults: {
      provider: "github.com",
      owner,
      category: DEFAULT_CATEGORIES[0],
    },
    editor: {
      codeWorkspace: {
        enabled: true,
      },
    },
  };
}
