# ghq-sector

[![npm version](https://img.shields.io/npm/v/ghq-sector?logo=npm&label=npm)](https://www.npmjs.com/package/ghq-sector)

You want to work across many repositories with AI agents. But how do you organize them?

- **Manage directories by hand?** Hard to reproduce on another machine.
- **Git submodules?** Even more painful.
- **Just use `ghq`?** Great for cloning — but as repos pile up, the flat layout becomes hard to navigate.

`ghq-sector` solves this by layering **categorized workspace views** on top of `ghq`. Your clones stay where `ghq` put them. On top of that, `ghq-sector` builds a structured working area with category directories, symlinks, and a generated VS Code `.code-workspace` — reproducible across machines with a single config file.

![ghq-sector UI demo](./ghq-sector.gif)

**Language:** English | [日本語](./docs/README.ja.md)

## What it does

`ghq-sector` helps you:

- keep clones managed by `ghq` (no duplication, no submodules)
- organize repos into human-readable categories (`projects`, `tools`, `docs`, …)
- generate a `.code-workspace` file so editors and AI agents see a clean, structured workspace
- manage everything visually or as raw JSON — and reproduce it anywhere

## Why this matters

A symlink-only workspace is easy to understand, but the symlinks themselves are machine-local state. They embed real filesystem paths, so copying the workspace directory to another machine is not enough when `ghqRoot`, usernames, or home directory layouts differ.

`ghq-sector` makes the **config file** the source of truth instead of the symlinks:

- keep one portable JSON/YAML config in version control
- regenerate the local workspace from that config on each machine
- adapt to different `ghqRoot` and `workspaceRoot` values without hand-editing every link
- detect drift with `gsec doctor` and repair it with `gsec sync`

In other words, the value is not just “create symlinks once,” but “rebuild the same categorized workspace reliably on any machine.”

## Requirements

- Node.js 20+
- `ghq`
- `gh` for GitHub account-aware repo suggestions in the editor and shorthand owner flows

## Windows note

`ghq-sector` creates symlinks in the workspace. On Windows, creating symlinks may require either:

- an elevated shell (Run as Administrator), or
- Windows Developer Mode enabled

If `gsec sync` or `gsec apply` fails with `EPERM: operation not permitted, symlink ...`, rerun the command from an elevated shell or enable Developer Mode first.

## Install

Run without installing:

```bash
npx ghq-sector init
bunx ghq-sector init
```

Install globally:

```bash
npm install -g ghq-sector
gsec --help
```

> [!NOTE]
> `gsec` is the installed shorthand command. When you run `ghq-sector` through `npx` or `bunx`, use `ghq-sector ...` instead. `gsec` becomes available after a local or global installation that exposes the package binaries.

Package pages:

- npm: <https://www.npmjs.com/package/ghq-sector>
- npmx: <https://npmx.dev/package/ghq-sector>

## Quick start

Get started without installing:

```bash
npx ghq-sector init
# or
bunx ghq-sector init
```

Then open the visual config editor to manage your workspace:

```bash
gsec edit
```

The editor is built with [visual-json](https://github.com/vercel-labs/visual-json) — edit your config visually or as raw JSON, preview changes, and apply them in one place. See [Commands](#commands) for the full CLI reference.

## What it creates

- `ghq-sector.config.json`
- category directories under `workspaceRoot`
- symlinks pointing to repositories managed by `ghq`
- copied resources declared in `resources`
- a generated VS Code `.code-workspace` file when enabled

## Portable config behavior

`ghq-sector` treats the config file as portable and the generated workspace as machine-local:

- `ghqRoot` and `workspaceRoot` are saved in portable form when possible, such as `~/ghq`
- runtime commands resolve those paths on the current machine before cloning, syncing, previewing, or applying
- `ghqRoot` may be adapted to the current machine's detected `ghq root`
- symlinks and generated workspace files should be regenerated per machine with `gsec sync` or `gsec apply`

If you copy a workspace/config directory between macOS, Linux, or Windows environments, keep the config under version control and regenerate the local workspace instead of copying existing symlinks.

Default categories:

- `projects`
- `tools`
- `docs`

## Included skills

This repository also includes reusable skills under `skills/` for AI agents and automation workflows.

| Skill | Purpose | When to use |
|---|---|---|
| `ghq-sector-cli` | Guides an agent through the normal `gsec` / `ghq-sector` command flow. | Use when you want to set up, edit, clone, sync, doctor, or apply a ghq-sector workspace through the CLI. |
| `ghq-sector-manual-workspace` | Explains how to build an equivalent categorized workspace manually without installing the CLI. | Use when an agent or user cannot install `ghq-sector` and needs mkdir/symlink/manual JSON instructions instead. |

### Install these skills

Add the skills from this repository with:

```bash
npx skills add https://github.com/ts-76/ghq-sector.git
```

Installed skills:

- `ghq-sector-cli`
- `ghq-sector-manual-workspace`

Use `ghq-sector-cli` when the agent can run the CLI. Use `ghq-sector-manual-workspace` when the agent cannot install or execute `ghq-sector` and must reproduce the workspace with plain shell operations.

## Commands

### `gsec init`

Create a config file, prepare the workspace root, create category directories, and optionally open the editor immediately.

```bash
gsec init
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

Options:

- `--ghq-root <path>`: set the `ghq` root directory
- `--workspace-root <path>`: set the workspace root
- `--yes`: skip prompts and use defaults

### `gsec sync`

Regenerate symlinks, copy configured resources, and regenerate the `.code-workspace` file from the current config.

```bash
gsec sync
```

### `gsec clone`

Clone a repository with `ghq`, append it to the config, and sync the workspace.

```bash
gsec clone owner/repo
gsec clone repo --owner owner --category projects
gsec clone github.com/owner/repo --provider github.com
```

Accepted repository formats:

- `provider/owner/name`
- `owner/name`
- `name` with `--owner` or `defaults.owner`

Options:

- `--category <name>`: assign the repo to a category
- `--owner <name>`: override the owner for shorthand repo names
- `--provider <name>`: override the provider for shorthand repo names
- `--yes`: skip owner selection and use the active/default account when possible

### `gsec doctor`

Validate environment setup, config consistency, resource paths, and workspace health.

```bash
gsec doctor
```

Checks include:

- `ghq` and `gh` availability
- config validity and category consistency
- resource source and target paths
- code-workspace generation status
- symlink and source-path health for existing repos

### `gsec edit`

Start the local config editor UI. The editor is built with [visual-json](https://github.com/vercel-labs/visual-json).

```bash
gsec edit
gsec edit --config ./ghq-sector.config.json --no-open
gsec edit --host 0.0.0.0 --port 4173
```

Options:

- `--config <path>`: config file path or a directory containing the config
- `--host <host>`: host to bind the editor server to
- `--port <port>`: port to bind the editor server to
- `--no-open`: do not open a browser automatically

## Config file

`gsec init` creates `ghq-sector.config.json`.

Typical fields:

- `ghqRoot`
- `workspaceRoot`
- `categories`
- `defaults`
- `repos`
- `resources`
- `hooks`
- `editor`

## AI workflow angle

`ghq-sector` is not an autonomous agent — it is the workspace layer *around* your AI workflow.

AI tools work best when your repositories are easy to discover and grouped by purpose. `ghq-sector` gives agents a stable, categorized filesystem to operate in, while keeping humans in control of what goes where.

## Support

If you run into a problem or want to request a feature, open an issue on GitHub.

## License

MIT
