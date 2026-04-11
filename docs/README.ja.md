# ghq-sector

`ghq` で管理しているリポジトリ群を、カテゴリ別の workspace に整理し、symlink、VS Code 用 `.code-workspace`、ローカル設定エディタを提供する CLI です。

**Language:** [English](../README.md) | 日本語

## 必要環境

- Node.js 20+
- `ghq`
- `gh`

## インストール

インストールせずに実行:

```bash
npx ghq-sector init
bunx ghq-sector init
```

グローバルインストール:

```bash
npm install -g ghq-sector
gsec --help
```

## クイックスタート

現在のディレクトリに設定ファイルと workspace template を作成:

```bash
gsec init --yes
```

リポジトリを追加して workspace を同期:

```bash
gsec clone owner/repo
gsec sync
```

環境と設定の状態確認:

```bash
gsec doctor
```

ローカルエディタを起動:

```bash
gsec edit
```

## 作成されるもの

- `ghq-ws.config.json` または `ghq-ws.config.yaml`
- `workspace-template/`
- `workspaceRoot` 配下の category directory
- `ghq` 管理下の repository への symlink
- VS Code 用 `.code-workspace`

デフォルト category:

- `projects`
- `tools`
- `docs`

## コマンド

### `gsec init`

設定ファイル、workspace template、category directory を作成します。

```bash
gsec init
gsec init --format yaml
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

オプション:

- `--ghq-root <path>`: `ghq` の root directory を指定
- `--workspace-root <path>`: 生成先 workspace root を指定
- `--format <json|yaml>`: config format を選択
- `--yes`: 対話をスキップして default を使う

### `gsec sync`

現在の config から symlink、resource、`.code-workspace` を再生成します。

```bash
gsec sync
```

### `gsec clone`

`ghq` でリポジトリを取得し、config に追加してから workspace を同期します。

```bash
gsec clone owner/repo
gsec clone repo --owner owner --category projects
gsec clone github.com/owner/repo --provider github.com
```

受け付ける repository 形式:

- `provider/owner/name`
- `owner/name`
- `name` + `--owner` または `defaults.owner`

オプション:

- `--category <name>`: category を指定
- `--owner <name>`: shorthand repo 名に対する owner を上書き
- `--provider <name>`: shorthand repo 名に対する provider を上書き
- `--yes`: owner 選択を省略し、active/default account を可能な範囲で使う

### `gsec doctor`

環境と config の整合性を検証します。

```bash
gsec doctor
```

確認内容:

- `ghq` と `gh` が利用可能か
- config が妥当か
- repo の category 参照が正しいか
- workspace resource と生成ファイルの状態
- 既存 workspace に対する symlink と source path の健全性

### `gsec edit`

ローカルの config editor UI を起動します。

```bash
gsec edit
gsec edit --config ./ghq-ws.config.json --no-open
gsec edit --host 0.0.0.0 --port 4173
```

オプション:

- `--config <path>`: config file の path、または config を含む directory
- `--host <host>`: editor server の bind host
- `--port <port>`: editor server の bind port
- `--no-open`: ブラウザを自動で開かない

エディタの主な機能:

- visual / raw の両方で config 編集
- schema-aware validation
- apply 前の workspace preview
- config の save と apply
- doctor refresh
- `gh` が使える場合の repository suggestion

## Config file

`gsec init` はデフォルトで `ghq-ws.config.json` を生成します。
`--format yaml` を使うと `ghq-ws.config.yaml` になります。

代表的なフィールド:

- `ghqRoot`
- `workspaceRoot`
- `categories`
- `defaults`
- `repos`
- `resources`
- `hooks`

## サポート

不具合報告や機能要望は GitHub Issues を利用してください。

## ライセンス

MIT
