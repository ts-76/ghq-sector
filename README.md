# ghq-sector

Organize `ghq`-managed repositories into category-based workspaces with symlinks, a generated VS Code `.code-workspace` file, and a local config editor.

**Language:** English | [日本語](./docs/README.ja.md)

## Requirements

- Node.js 20+
- `ghq`
- `gh`

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

## Quick start

Create a config file and workspace template in the current directory:

```bash
gsec init --yes
```

Add a repository and sync the workspace:

```bash
gsec clone owner/repo
gsec sync
```

Check environment and config health:

```bash
gsec doctor
```

Open the local editor:

```bash
gsec edit
```

## What it creates

- `ghq-ws.config.json` or `ghq-ws.config.yaml`
- `workspace-template/`
- category directories under `workspaceRoot`
- symlinks to repositories managed by `ghq`
- a VS Code `.code-workspace` file

Default categories:

- `projects`
- `tools`
- `docs`

## Commands

### `gsec init`

Create a config file, workspace template, and category directories.

```bash
gsec init
gsec init --format yaml
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

Options:

- `--ghq-root <path>`: set the `ghq` root directory
- `--workspace-root <path>`: set the generated workspace root
- `--format <json|yaml>`: choose the config format
- `--yes`: skip prompts and use defaults

### `gsec sync`

Regenerate symlinks, copied resources, and the `.code-workspace` file from the current config.

```bash
gsec sync
```

### `gsec clone`

Clone a repository with `ghq`, add it to the config, and sync the workspace.

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

Validate environment setup and config consistency.

```bash
gsec doctor
```

Checks include:

- `ghq` and `gh` availability
- config validity
- category references in repositories
- workspace resources and generated files
- symlink and source-path health for an existing workspace

### `gsec edit`

Start the local config editor UI.

```bash
gsec edit
gsec edit --config ./ghq-ws.config.json --no-open
gsec edit --host 0.0.0.0 --port 4173
```

Options:

- `--config <path>`: config file path or a directory containing the config
- `--host <host>`: host to bind the editor server to
- `--port <port>`: port to bind the editor server to
- `--no-open`: do not open a browser automatically

The editor includes:

- visual and raw config editing
- schema-aware validation
- workspace preview before apply
- save and apply actions
- doctor refresh
- repository suggestions from `gh` when available

## Config file

`gsec init` creates `ghq-ws.config.json` by default.
Use `--format yaml` to create `ghq-ws.config.yaml` instead.

Typical config fields:

- `ghqRoot`
- `workspaceRoot`
- `categories`
- `defaults`
- `repos`
- `resources`
- `hooks`

## Maintainer release flow

Project maintenance is PR-only:

1. Open a pull request against `main`
2. Wait for `verify`, `audit`, and `codeql (javascript-typescript)` to pass
3. Merge the pull request
4. Let the `Release` workflow create the GitHub Release and publish to npm from `main`

Use conventional commits (`feat:`, `fix:`, etc.) so the release workflow can determine the next version automatically.
Avoid direct pushes to `main` during normal operation.

## Support

If you run into a problem or want to request a feature, open an issue on GitHub.

## License

MIT
