---
name: ghq-sector-manual-workspace
description: >
  How to manually set up a categorized symlink workspace equivalent to ghq-sector, without
  installing any tools. Use this skill whenever the user wants to organize ghq-managed repositories
  into categories but cannot or prefers not to install ghq-sector, or when working in an environment
  where only basic shell tools (mkdir, ln) are available. Also trigger when the user mentions
  manual workspace setup with ghq, creating symlinks for repos, organizing repos by category,
  building a .code-workspace file by hand, or setting up a multi-repo workspace without ghq-sector.
---

# Manual Workspace Setup (ghq-sector equivalent)

This guide shows how to replicate what ghq-sector does using only a JSON config file, `mkdir`, and `ln -s`. An AI agent can perform all these steps — no special CLI required.

## What you're building

A workspace root with category directories, each containing symlinks pointing to the real repositories managed by `ghq`. Optionally, a VS Code `.code-workspace` file that opens all categories as a multi-root workspace.

```
~/workspace/main/
├── projects/
│   ├── my-app -> ~/ghq/github.com/me/my-app
│   └── api-server -> ~/ghq/github.com/me/api-server
├── tools/
│   └── dotfiles -> ~/ghq/github.com/me/dotfiles
├── docs/
│   └── wiki -> ~/ghq/github.com/team/wiki
└── main.code-workspace
```

## Step-by-step

### 0. Check prerequisites and gather info

Before creating anything, verify the environment and collect the information needed.

**Ask the user for the workspace directory.** Present a reasonable default and let them confirm or change it:

> Where should the workspace root be created? (default: `~/workspace/main`)

Then run these checks:

```bash
# Verify ghq is installed and get its root
ghq root

# Verify gh is installed
gh --version

# List existing repositories the user has access to
gh repo list --limit 100
```

If `ghq` is not available, the user needs to install it first (`brew install ghq` or equivalent). If `gh` is not available, you can still proceed — you just won't be able to auto-discover repos.

Use `gh repo list` output to help the user decide which repos to include. Group suggestions by org/owner to make categorization easier.

### 1. Create a config file

Create `workspace.config.json` (any name works — this is just a reference for the agent and for future reprovisioning). Use the workspace directory the user chose in step 0:

```json
{
  "ghqRoot": "~/ghq",
  "workspaceRoot": "~/workspace/main",
  "categories": ["projects", "tools", "docs"],
  "repos": [
    { "provider": "github.com", "owner": "me", "name": "my-app", "category": "projects" },
    { "provider": "github.com", "owner": "me", "name": "api-server", "category": "projects" },
    { "provider": "github.com", "owner": "me", "name": "dotfiles", "category": "tools" },
    { "provider": "github.com", "owner": "team", "name": "wiki", "category": "docs" }
  ]
}
```

Replace `~/workspace/main` with the user's chosen path. Populate `repos` based on the user's selections from the `gh repo list` output and their desired categories.

**Required fields per repo:**
- `provider` — git host (e.g. `github.com`)
- `owner` — repository owner or org
- `name` — repository name
- `category` — which category directory the symlink goes in

### 2. Create the workspace structure

```bash
mkdir -p ~/workspace/main/projects
mkdir -p ~/workspace/main/tools
mkdir -p ~/workspace/main/docs
```

Create one directory per category listed in the config. Replace `~/workspace/main` with the user's chosen workspace root.

### 3. Create symlinks

For each repo entry, create a symlink from the workspace category directory to the ghq-managed source:

```bash
# Pattern: ln -s <ghqRoot>/<provider>/<owner>/<name> <workspaceRoot>/<category>/<name>
ln -s ~/ghq/github.com/me/my-app <workspaceRoot>/projects/my-app
ln -s ~/ghq/github.com/me/api-server <workspaceRoot>/projects/api-server
ln -s ~/ghq/github.com/me/dotfiles <workspaceRoot>/tools/dotfiles
ln -s ~/ghq/github.com/team/wiki <workspaceRoot>/docs/wiki
```

Replace `<workspaceRoot>` with the user's chosen path.

**Source path convention** (ghq default): `<ghqRoot>/<provider>/<owner>/<name>`

If a symlink already exists and points correctly, skip it. If it points to the wrong location, remove and recreate:

```bash
ln -sfn ~/ghq/github.com/me/my-app <workspaceRoot>/projects/my-app
```

### 4. (Optional) Generate .code-workspace

Create `<workspaceRoot>/<basename>.code-workspace` (use the directory name of workspaceRoot as the filename):

```json
{
  "folders": [
    { "path": "projects" },
    { "path": "tools" },
    { "path": "docs" }
  ]
}
```

This lets VS Code (and AI agents using VS Code) open all categories as a single workspace.

### 5. (Optional) Copy shared resources

If you have files that should exist in the workspace root (e.g. `.envrc`, `.editorconfig`), copy them:

```bash
cp /path/to/template/.envrc <workspaceRoot>/.envrc
```

## Adding a new repo

1. Clone it with ghq: `ghq get owner/repo`
2. Add an entry to the config JSON
3. Create the symlink: `ln -s ~/ghq/github.com/owner/repo <workspaceRoot>/<category>/repo`

## Replacing on a new machine

1. Copy `workspace.config.json` to the new machine
2. `ghq get` each repo (or let the agent do it)
3. Re-run steps 2–3 (mkdir + ln -s)
4. Regenerate the `.code-workspace` if needed

## Why this works without ghq-sector

The core of ghq-sector is:
1. A JSON file listing repos and their categories
2. `mkdir` for category directories
3. `ln -s` to point symlinks at ghq's clone locations
4. A `.code-workspace` JSON file

All of these are standard shell operations. The config file serves as documentation and a reprovisioning script — an AI agent reading this skill can generate all the commands from the config alone.
