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
- `workspaceRoot/.agents/skills/...` と `workspaceRoot/.claude/skills/...` 配下の optional な agent skill symlink
- `resources` に定義した copy 対象
- 有効な場合は VS Code 用 `.code-workspace`
- agent skill sync を有効にした場合の `.ghq-sector/agent-skills-report.json` と `.md` レポート

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

Sync は repository と skill のリンク計画全体を、リンク変更前に検査します。`workspaceRoot` 外の宛先、workspace 内の親 symlink、重複・包含関係にあるリンク宛先、実ファイル・実ディレクトリ（空を含む）との衝突を拒否し、保護したパスと理由を表示します。`workspaceRoot` は実ディレクトリを指定してください。root 自体が symlink の場合は、その実体のパスを指定します。

設定された source をすでに指すリンクは、source が存在しない壊れたリンクも含めて保持します。別のリンク先へ更新できるのは、現在のリンク先が `.ghq-sector/repo-links-manifest.json` または `agent-skills-manifest.json` に記録された source と一致する場合だけです。想定外のリンクは変更しません。不要になった skill は、記録された宛先と実際のリンク先が一致する symlink だけを削除し、リンク先の実体や実ファイル・ディレクトリを再帰削除しません。従来のパスだけの skill manifest では管理対象と確認できないため、不要なエントリーは手動確認用に保持します。衝突するエントリーの移動または設定の変更後に Sync / Apply を再実行してください。この保護の対象は管理リンクとその metadata です。設定済み resources のコピーと hooks のコマンド実行は引き続き設定どおりに行います。

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
gsec edit --host localhost --port 4173
```

オプション:

- `--config <path>`: config file の path、または config を含む directory
- `--host <host>`: editor server の bind host
- `--port <port>`: editor server の bind port
- `--no-open`: ブラウザを自動で開かない

editor の bind は `127.0.0.1` / `::1` / `localhost` のみです。`0.0.0.0` などは起動前に拒否します。表示された URL をそのまま開いてください。全 API で Host と同じ Origin を検証します。Origin がないブラウザの same-origin fetch は許可し、それ以外のローカルクライアントには `X-Ghq-Sector-Request: 1` を要求します。読み取りも cross-site request は拒否します。

Save / Preview / Apply / repo ドラフト提案は UTF-8 の `application/json`、最大 1 MiB です。不正 JSON・schema は 400、サイズ超過は 413、Content-Type 不一致は 415 を返します。repo 提案は `{config: currentDraft, repo: optionalRepo}` を受け、ファイル保存せずドラフトを返します。Save / Apply 中は同じ設定への競合 API に 409 busy を返します。設定に隣接する `<config-file>.editor-lock` を排他的に作成し、別プロセス・別ポートの編集サーバー間でも保護します。外部 CLI や手動ファイル編集は含みません。異常終了で残った lease は、記録された PID が停止済みか確認してから、その lease ファイルだけを手動で削除してください。既存 lease を自動削除しません。

Apply 途中失敗は内部例外の詳細を伏せ、完了した stage と失敗 stage、`configSaved` を返します。失敗 stage は一部を変更済みの場合があり、完了した操作を巻き戻しません。workspace と Doctor の結果を確認してから hooks / Apply を再実行してください。

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
- `agentSkills`

### `agentSkills`

repository 内に分散した agent skill を `ghq-sector` で同期したい場合は、この設定を有効にします。

```json
{
  "agentSkills": {
    "enabled": true,
    "providers": ["agents", "claude"]
  }
}
```

挙動:

- 各 repo の `<repo>/.agents/skills/*/SKILL.md` と `<repo>/.claude/skills/*/SKILL.md` だけを走査します
- 選ばれた skill を `workspaceRoot/.agents/skills/<skill>` と `.claude` 側の同等パスへ link します
- `frontmatter.name` が重複した skill は config の `repos` 順で winner を決めます
- skip された duplicate と parse/name warning を `workspaceRoot/.ghq-sector/agent-skills-report.json` と `.md` に出力します
- `gsec edit` の preview は read-only のままで、実際の link と report は apply / sync / clone 時だけ作成されます

## AI workflow 観点での位置づけ

`ghq-sector` 自体は autonomous agent ではありません。AI workflow の*まわりに置く* workspace layer です。

AI ツールはリポジトリが見つけやすく用途ごとに整理されているほど使いやすくなります。`ghq-sector` は、agent に安定したカテゴリ別 filesystem を渡しつつ、何をどこに置くかの管理責任は人間が持ち続けられるようにします。

## サポート

不具合報告や機能要望は GitHub Issues を利用してください。

## ライセンス

MIT
