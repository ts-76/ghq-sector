# ghq-sector

`ghq` で管理している repository 群を、カテゴリ分けした workspace に symlink しつつ `.code-workspace` や補助 resource も生成する CLI です。

スタンドアロン package として `~/workspace/personal/ghq-sector` に分離済みです。

現状は **CLI + Svelte 製 config editor (`gsec edit`)** が利用でき、基本フローは **Save config / Apply workspace** に整理されています。

## Requirements

- `bun`
- `ghq`
- `gh`

## Local usage

```bash
cd ~/workspace/personal/ghq-sector
bun install
bun run cli --help
```

## Commands

### init

設定ファイルと workspace template を初期化します。

```bash
gsec init
gsec init --yes --format yaml
```

主な動作:
- `ghq-sector.config.json` or `.yaml` を生成
- `workspace-template/` を生成
- `workspaceRoot` 配下の category directory を生成
- resource copy / code-workspace generation / global `afterInit` hook 実行
- 対話モードでは最後に editor を開くか確認

### sync

config をもとに symlink / resources / `.code-workspace` を再生成します。

```bash
gsec sync
```

### clone

`ghq get` して config に repo を追加し、そのまま sync まで行います。

```bash
gsec clone ts-76/life
gsec clone life --owner ts-76 --category projects
```

対応形式:
- `provider/owner/name`
- `owner/name`
- `name` + `defaults.owner` または `--owner`

clone まわりの hook は repo 個別ではなく global hooks に集約されています。
- `hooks.beforeClone`
- `hooks.afterClone`
- `hooks.afterLink`
- `hooks.afterSync`

### doctor

環境と config の整合性を確認します。

```bash
gsec doctor
```

確認対象:
- `ghq` / `gh`
- config 妥当性
- defaults (`provider`, `owner`, `category`)
- `repo.category ∈ categories` の整合性
- resources source/target
- workspace が存在する場合のみ `.code-workspace` と各 repo の source / symlink 状態

### edit

ローカル UI を起動して config を視覚編集します。

```bash
gsec edit
gsec edit --config ../../ghq-sector.config.json --no-open
```

機能:
- visual / raw tab
- schema-aware editing via `@visual-json/svelte`
- Save config
- Apply workspace (`ghq get` for missing repos + symlink sync + resources + `.code-workspace` + config copy)
- workspace preview (`ready` / `will fetch via ghq get`)
- Doctor refresh
- repo preset insertion from `gh` repository list when available
- repo entry は provider / owner / name / category の最小構造に統一
- hook 設定は global hooks に集約
- default categories は `projects` / `tools` / `docs`

## Build

### Typecheck

```bash
bun run typecheck
```

### Tests

```bash
bun test
```

現在の自動テストは以下をカバーします。

**unit / mock で保証する範囲**
- config の cross-field validation (`repo.category ∈ categories`)
- template の default categories
- workspace preview / plan の `ready` / `fetch` 判定
- `runApply` の fetched / alreadyPresent / sync / config copy 集約結果
- `ensureRepos` の missing repo のみ `ghq get` 実行
- `ensureRepos` の `ghq get` failure 伝播
- hook 実行順序 (`beforeClone -> ghq get -> afterClone`)
- `runApply` が ensure 失敗時に sync / config copy へ進まないこと
- clone の repository 形式解釈 (`provider/owner/name`, `owner/name`, shorthand name + owner resolution)
- clone 時の config upsert
- shorthand clone で owner 未解決時の失敗
- doctor の `ghq` / `gh` 不在時エラー
- doctor の workspace 未作成時スキップ / source missing / workspace 存在時の code-workspace・symlink 診断

**lightweight integration で保証する範囲**
- `.code-workspace` 生成
- resource copy と config copy
- apply 実行後の workspace 整合性
  - already present repo は再 fetch されない
  - missing repo は `ghq get` 対象になる
  - symlink / `.code-workspace` / copied resource が期待どおり作られる

**あえて保証しない範囲**
- `git` / `ghq` / `gh` 自体の内部挙動
- 実ネットワーク越しの GitHub clone 成功可否
- `ghq get` の詳細な取得ロジック

### UI build

```bash
bun run build-ui
```

### Standalone binary

```bash
bun run build-bin
```

出力先:

```bash
dist/cli/main.mjs
```

### All-in-one build

```bash
bun run build
```

`build` は UI build の後に tsdown で CLI を生成します。

## UI dependency note

UI は npm 公開版の `@visual-json/svelte` を参照しています。
vendor tarball 前提は不要になりました。

## Thin wrapper

`life/scripts/setup-workspace.sh` は workspace 生成本体を持たず、`gsec init --yes` / `gsec sync` を呼ぶ thin wrapper です。

## Recommended next steps

現時点では MVP は成立しています。次にやるなら以下が有力です。

- doctor の責務をさらに絞る
- code-workspace settings / extensions / tasks の拡張
- 自動テスト追加
- build / release フローの整備
