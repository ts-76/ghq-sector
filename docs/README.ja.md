# ghq-sector

[![npm version](https://img.shields.io/npm/v/ghq-sector?logo=npm&label=npm)](https://www.npmjs.com/package/ghq-sector)

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
- visual editor または raw JSON で管理 — どのマシンでも再現可能

## なぜ価値があるのか

symlink ベースの workspace は単純で分かりやすい一方、symlink 自体はマシン固有の状態です。実際の filesystem path を含むため、`ghqRoot`、ユーザー名、home directory の構成が違う別マシンへ workspace directory をそのままコピーしても、そのままでは使えないことがあります。

`ghq-sector` は symlink そのものではなく **config file を source of truth** にします。

- 持ち運ぶのは 1 つの JSON/YAML config だけでよい
- 各マシンでその config から local workspace を再生成できる
- `ghqRoot` や `workspaceRoot` が違っても link を手で張り直さなくてよい
- `gsec doctor` でズレを検出し、`gsec sync` で再同期できる

つまり価値は「一度 symlink を作ること」ではなく、「同じカテゴリ付き workspace をどのマシンでも確実に復元できること」です。

## 必要環境

- Node.js 20+
- `ghq`
- `gh`（editor の GitHub repository suggestion や shorthand owner 解決で使用）

## Windows での注意

`ghq-sector` は workspace 内に symlink を作成します。Windows では symlink 作成に次のいずれかが必要な場合があります。

- 管理者権限で起動した shell
- Windows の開発者モードの有効化

`gsec sync` や `gsec apply` 実行時に `EPERM: operation not permitted, symlink ...` が出る場合は、管理者権限の shell で再実行するか、先に開発者モードを有効にしてください。

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

インストール不要ですぐ始められます:

```bash
npx ghq-sector init
# または
bunx ghq-sector init
```

続いて visual config editor でワークスペースを管理:

```bash
gsec edit
```

エディタは [visual-json](https://github.com/vercel-labs/visual-json) を使って構築されており、visual / raw JSON の両方で config を編集し、変更を preview して apply できます。CLI の全コマンドは[コマンド](#コマンド)セクションを参照してください。

## 作成されるもの

- `ghq-sector.config.json`
- `workspaceRoot` 配下の category directory
- `ghq` 管理下の repository を指す symlink
- `resources` に定義した copy 対象
- 有効な場合は VS Code 用 `.code-workspace`

デフォルト category:

- `projects`
- `tools`
- `docs`

## 同梱 skill

この repository には、AI agent や自動化フロー向けに `skills/` 配下の再利用可能な skill も含まれています。

| Skill | 目的 | 使う場面 |
|---|---|---|
| `ghq-sector-cli` | 通常の `gsec` / `ghq-sector` コマンドフローを案内する skill | CLI 経由で workspace の初期化、編集、clone、sync、doctor、apply を行いたいとき |
| `ghq-sector-manual-workspace` | CLI を使わずに同等の categorized workspace を手動構築する手順をまとめた skill | `ghq-sector` をインストールできない環境で、mkdir / symlink / 手書き JSON による構築手順が必要なとき |

### skill の追加方法

この repository から skill を追加するには、次を実行します。

```bash
npx skills add https://github.com/ts-76/ghq-sector.git
```

追加される skill:

- `ghq-sector-cli`
- `ghq-sector-manual-workspace`

CLI を実行できる場合は `ghq-sector-cli` を、`ghq-sector` をインストール・実行できず plain shell operation で workspace を再現したい場合は `ghq-sector-manual-workspace` を使ってください。

## コマンド

### `gsec init`

config file を作成し、workspace root と category directory を準備し、必要ならそのまま editor を開きます。

```bash
gsec init
gsec init --ghq-root ~/ghq --workspace-root ~/workspace/sector --yes
```

オプション:

- `--ghq-root <path>`: `ghq` の root directory を指定
- `--workspace-root <path>`: workspace root を指定
- `--yes`: 対話をスキップして default を使う

### `gsec sync`

現在の config から symlink、resources、`.code-workspace` を再生成します。

```bash
gsec sync
```

### `gsec apply`

config の完全な状態を反映します。`ghq` 内に不足している repository を揃え、workspace を sync し、config file を workspace root にコピーします。

```bash
gsec apply
```

editor の **Apply** 操作と同等の処理を CLI から実行したいときに使います。

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
