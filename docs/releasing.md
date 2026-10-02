# Releasing ghq-sector

Release Please replaces semantic-release. Ordinary commits update a release PR;
merging that PR advances the tracked package version and changelog. The initial
manifest and package version are 1.3.0, matching the existing v1.3.0 release. The
bootstrap commit is that release's commit; older changes are not released again.

The existing `release.yml` workflow handles release PRs, verification, GitHub
releases, and npm publication in separate jobs. All jobs are restricted to main.
A failing audit or acceptance check prevents GitHub release/tag creation and npm
publication. Publication checks out the commit returned by Release Please and
requires its package version to match the release tag. The official Release Please CLI 17.11.2 and its execution dependencies are locked
in the root Bun/npm locks and audited before use. The distribution Action is
avoided because its bundled lock contains vulnerable dependencies. npm is pinned
in `.github/publish-cli/package-lock.json`.

## Review and authentication

The release PR uses the existing GITHUB_TOKEN with the existing contents, issues,
and pull request permissions. GitHub does not automatically run PR workflows for
PRs created with this token. Before merging a release PR, run **CI** and **Security**
using their workflow_dispatch controls, selecting the release PR branch, and
review the resulting checks. Do not add a personal token just to trigger CI.
The release workflow also verifies the merged main commit before creating a tag.

The publish job retains the existing id-token permission and the `release.yml`
filename for npm trusted publishing. It creates no npm tokens and changes no
trusted publisher settings. Actual OIDC authentication can only be verified in
a real GitHub-hosted publication; a local publish dry run cannot verify it. If the
existing trusted publisher rejects this workflow, stop and review its existing
configuration rather than creating new credentials or expanding permissions.

## Local acceptance and publish CLI audit

Use Node 24 and Bun 1.3.13. Install root and UI dependencies with Bun, preserving
the Socket scanner and minimum release age. The separate publish tool uses npm
ci because its npm lockfile records npm's bundled dependency tree:

```sh
bun install --frozen-lockfile
bun install --cwd ui --frozen-lockfile
npm ci --prefix .github/publish-cli --ignore-scripts --no-audit --no-fund
bun run lint
bun run typecheck
bun run --cwd ui typecheck
bun run test
bun run build
bun run audit
bun run publish:dry-run
```

`--no-audit` applies only to installation; the required subsequent audit is not
suppressed. `bun run audit` checks the root, UI, root npm lockfile, and the exact
npm CLI used for publishing. The explicit Node entry point avoids accidentally
selecting a different global npm or a runner's newest npm. The dry-run script uses a temporary tarball, checks both CLI bin entries and the
UI assets, disables credential/OIDC access, and calls the exact pinned CLI with
`--dry-run --offline` and a fresh cache. This also allows testing the existing
1.3.0 baseline without a registry version collision. It does not publish or
execute lifecycle scripts; the package has no required publish lifecycle scripts.

## Current upstream blocker (2026-10-02)

Application and UI audits are clean after the dependency refresh. The pinned npm
11.20.0 CLI still bundles brace-expansion 5.0.9, ip-address 10.5.0, and undici
6.28.0. npm audit reports two high and one moderate vulnerable packages. The
checked npm 11.21.0 and 12.2.0 tarballs contain the same affected copies. Consumer
overrides and npm audit fix do not replace these bundled dependencies.

The publish CLI remains visible to Security CI and blocks tags/publication. Do
not ignore these findings, weaken the audit level, or bypass verification. Update
the pinned tool and lockfile when an upstream CLI with fixed bundled dependencies
is available, then repeat the CLI audit, dry run, acceptance checks, and CI.
