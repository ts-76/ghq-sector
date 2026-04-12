# ghq-sector

AI agent と一緒にたくさんのリポジトリで作業したい。でも、どうやって管理する？

- **ディレクトリを自分で作って整理する？** 別のマシンに持ち出しにくい。
- **Git submodule にする？** それこそ大変だ。
- **`ghq` をそのまま使う？** clone 管理は楽だけど、リポジトリが増えてくるとフラットな構造が辛くなる。

`ghq-sector` は、`ghq` の上に**カテゴリ別の workspace view** を重ねることでこれを解決します。clone は `ghq` に任せたまま、カテゴリ directory・symlink・VS Code 用 `.code-workspace` を一枚の config file から再現可能な形で構築します。

![ghq-sector UI demo](../ghq-sector.gif)

**Language:** [English](../README.md) | 日本語

## できること

- clone 済み repository は `ghq` に集約したまま（重複なし、submodule なし）
- `projects`・`tools`・`docs` などのカテゴリで整理
- editor や AI agent が扱いやすい `.code-workspace` を自動生成
- visual editor または raw JSON/YAML で管理 — どのマシンでも再現可能

## 必要環境

- Node.js 20+
- `ghq`
- `gh`（editor の GitHub repository suggestion や shorthand owner 解決で使用）

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

> [!NOTE]
> `gsec` はインストール後に使える短縮コマンドです。`npx` や `bunx` で `ghq-sector` を直接実行する場合は、`gsec` ではなく `ghq-sector ...` を使ってください。`gsec` は package の binary がローカルまたはグローバルに配置されたあとに利用できます。

パッケージページ:

- npm: <https://www.npmjs.com/package/ghq-sector>
- npmx: <https://npmx.dev/package/ghq-sector>

## クイックスタート

config と workspace 構成を作成:

```bash
gsec init --yes
```

visual config editor UI を起動:

```bash
gsec edit
```

エディタは [visual-json](https://github.com/vercel-labs/visual-json) を使って構築されており、次の機能を提供します:

- visual / raw の両方で config 編集
- schema-aware validation
- apply 前の workspace preview
- config の save と apply
- doctor refresh
- `gh` が使える場合の repository suggestion

CLI でリポジトリを追加して同期:

```bash
gsec clone owner/repo
gsec sync
```

設定や workspace の状態を確認:

```bash
gsec doctor
```

## 作成されるもの

- `ghq-sector.config.json` または `ghq-sector.config.yaml`
- `workspaceRoot` 配下の category directory
- `ghq` 管理下の repository を指す symlink
- `resources` に定義した copy 対象
- 有効な場合は VS Code 用 `.code-workspace`

デフォルト category:

- `projects`
- `tools`
- `docs`

## コマンド

### `gsec init`

config file を作成し、workspace root と category directory を準備し、必要ならそのまま editor を開きます。

```bash
gsec init
gsec init --format yaml
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

オプション:

- `--ghq-root <path>`: `ghq` の root directory を指定
- `--workspace-root <path>`: workspace root を指定
- `--format <json|yaml>`: config format を選択
- `--yes`: 対話をスキップして default を使う

### `gsec sync`

現在の config から symlink、resources、`.code-workspace` を再生成します。

```bash
gsec sync
```

### `gsec clone`

`ghq` で repository を取得し、config に追加して workspace を同期します。

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

環境、config、resource path、workspace の状態を検証します。

```bash
gsec doctor
```

確認内容:

- `ghq` と `gh` が利用可能か
- config が妥当で category 整合性が取れているか
- resource の source / target path
- code-workspace の生成状態
- 既存 repository に対する symlink と source path の健全性

### `gsec edit`

ローカルの config editor UI を起動します。エディタは [visual-json](https://github.com/vercel-labs/visual-json) を使って構築されています。

```bash
gsec edit
gsec edit --config ./ghq-sector.config.json --no-open
gsec edit --host 0.0.0.0 --port 4173
```

オプション:

- `--config <path>`: config file の path、または config を含む directory
- `--host <host>`: editor server の bind host
- `--port <port>`: editor server の bind port
- `--no-open`: ブラウザを自動で開かない

## Config file

`gsec init` はデフォルトで `ghq-sector.config.json` を生成します。
`--format yaml` を使うと `ghq-sector.config.yaml` を生成します。

代表的なフィールド:

- `ghqRoot`
- `workspaceRoot`
- `categories`
- `defaults`
- `repos`
- `resources`
- `hooks`
- `editor`

## AI workflow 観点での位置づけ

`ghq-sector` 自体は autonomous agent ではありません。AI workflow の*まわりに置く* workspace layer です。

AI ツールはリポジトリが見つけやすく用途ごとに整理されているほど使いやすくなります。`ghq-sector` は、agent に安定したカテゴリ別 filesystem を渡しつつ、何をどこに置くかの管理責任は人間が持ち続けられるようにします。

## サポート

不具合報告や機能要望は GitHub Issues を利用してください。

## ライセンス

MIT
