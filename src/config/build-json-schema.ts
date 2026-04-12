export interface JsonSchema {
  type: string;
  description?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

export function buildJsonSchema(): JsonSchema {
  return {
    type: "object",
    description:
      "ghq-sector configuration for generating a categorized symlink workspace from ghq-managed repositories.",
    required: ["ghqRoot", "workspaceRoot", "categories", "repos"],
    properties: {
      ghqRoot: {
        type: "string",
        description:
          "Absolute path to your ghq root. Enter the raw path only, without wrapping quotes. Example: /Users/you/ghq",
      },
      workspaceRoot: {
        type: "string",
        description:
          "Absolute path to the workspace root where category directories and symlinks will be created. Enter the raw path only, without wrapping quotes.",
      },
      categories: {
        type: "array",
        description:
          "Ordered list of category directory names created under workspaceRoot. Example: projects, tools, docs.",
        items: {
          type: "string",
          description: "Single category directory name.",
        },
      },
      defaults: {
        type: "object",
        description:
          "Default values used when clone input is shorthand such as owner/repo or just repo.",
        properties: {
          provider: {
            type: "string",
            description: "Default git host. Usually github.com.",
          },
          owner: {
            type: "string",
            description:
              "Default repository owner or organization used when clone input omits the owner. Enter the raw value only, without wrapping quotes.",
          },
          category: {
            type: "string",
            description:
              "Default destination category used for cloned repositories when category is not specified.",
          },
        },
      },
      repos: {
        type: "array",
        description:
          "Repositories to link from ghq into the categorized workspace.",
        items: {
          type: "object",
          description:
            "One repository entry to clone or link into the workspace.",
          required: ["provider", "owner", "name", "category"],
          properties: {
            provider: {
              type: "string",
              description:
                "Git provider host for this repository. Example: github.com.",
            },
            owner: {
              type: "string",
              description: "Repository owner or organization name.",
            },
            name: {
              type: "string",
              description: "Repository name without owner. Example: life.",
            },
            category: {
              type: "string",
              description:
                "Category directory under workspaceRoot where the symlink should be created.",
            },
          },
        },
      },
      hooks: {
        type: "object",
        description:
          "Global hooks. Use {{ var }} in commands to inject context. Variables differ per hook.",
        properties: {
          afterInit: {
            type: "array",
            description:
              "Commands run after init. Variables: {{ ghqRoot }}, {{ workspaceRoot }}.",
            items: {
              type: "string",
              description: "Shell command. Executed from workspaceRoot.",
            },
          },
          beforeClone: {
            type: "array",
            description:
              "Commands run before ghq get. Variables: {{ provider }}, {{ owner }}, {{ repo }}, {{ category }}, {{ ghqPath }}, {{ workspacePath }}, {{ ghqRoot }}, {{ workspaceRoot }}.",
            items: {
              type: "string",
              description: "Shell command. Executed from workspacePath.",
            },
          },
          afterClone: {
            type: "array",
            description:
              "Commands run after ghq get, before linking. Variables: {{ provider }}, {{ owner }}, {{ repo }}, {{ category }}, {{ ghqPath }}, {{ workspacePath }}, {{ ghqRoot }}, {{ workspaceRoot }}.",
            items: {
              type: "string",
              description: "Shell command. Executed from workspacePath.",
            },
          },
          afterLink: {
            type: "array",
            description:
              "Commands run per-repo after symlink creation. Variables: {{ provider }}, {{ owner }}, {{ repo }}, {{ category }}, {{ ghqPath }}, {{ workspacePath }}, {{ ghqRoot }}, {{ workspaceRoot }}.",
            items: {
              type: "string",
              description:
                "Shell command. Executed from workspacePath. Example: direnv allow {{ workspacePath }}",
            },
          },
          afterSync: {
            type: "array",
            description:
              "Commands run once after all repos linked. Variables: {{ ghqRoot }}, {{ workspaceRoot }}, {{ linkedCount }}.",
            items: {
              type: "string",
              description: "Shell command. Executed from workspaceRoot.",
            },
          },
        },
      },
      resources: {
        type: "array",
        description:
          "Files or directories copied into workspaceRoot after sync/init.",
        items: {
          type: "object",
          description: "One copy rule for resource syncing.",
          required: ["from", "to"],
          properties: {
            from: {
              type: "string",
              description:
                "Source path relative to the config project root. Enter the raw path only, without wrapping quotes.",
            },
            to: {
              type: "string",
              description:
                "Destination path relative to workspaceRoot. Enter the raw path only, without wrapping quotes.",
            },
            mode: {
              type: "string",
              description:
                "Optional file mode or reserved copy mode setting used after copying.",
            },
          },
        },
      },
      editor: {
        type: "object",
        description: "Editor-specific settings for generated workspace files.",
        properties: {
          codeWorkspace: {
            type: "object",
            description:
              "Controls generation of the VS Code .code-workspace file.",
            properties: {
              enabled: {
                type: "boolean",
                description:
                  "When true, ghq-sector sync generates a .code-workspace file.",
              },
              filename: {
                type: "string",
                description:
                  "Output filename for the generated .code-workspace file.",
              },
            },
          },
        },
      },
    },
  };
}
