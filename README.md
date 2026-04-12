# ghq-sector

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
- manage everything visually or as raw JSON/YAML — and reproduce it anywhere

## Requirements

- Node.js 20+
- `ghq`
- `gh` for GitHub account-aware repo suggestions in the editor and shorthand owner flows

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

Create a config and workspace structure:

```bash
gsec init --yes
```

Open the visual config editor UI:

```bash
gsec edit
```

The editor is built with [visual-json](https://github.com/vercel-labs/visual-json) and provides:

- visual and raw config editing
- schema-aware validation
- workspace preview before apply
- save and apply actions
- doctor refresh
- repository suggestions from `gh` when available

Add a repository and sync from the CLI:

```bash
gsec clone owner/repo
gsec sync
```

Check configuration and workspace health:

```bash
gsec doctor
```

## What it creates

- `ghq-sector.config.json` or `ghq-sector.config.yaml`
- category directories under `workspaceRoot`
- symlinks pointing to repositories managed by `ghq`
- copied resources declared in `resources`
- a generated VS Code `.code-workspace` file when enabled

Default categories:

- `projects`
- `tools`
- `docs`

## Commands

### `gsec init`

Create a config file, prepare the workspace root, create category directories, and optionally open the editor immediately.

```bash
gsec init
gsec init --format yaml
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

Options:

- `--ghq-root <path>`: set the `ghq` root directory
- `--workspace-root <path>`: set the workspace root
- `--format <json|yaml>`: choose the config format
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

`gsec init` creates `ghq-sector.config.json` by default.
Use `--format yaml` to create `ghq-sector.config.yaml` instead.

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
