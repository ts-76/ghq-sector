# Release PRs and npm staging

Release Please replaces semantic-release. Ordinary main commits maintain a
version/changelog release PR only after the main commit passes verification.
The manifest records the published 1.4.0 baseline. Since 1.4.0 was published
without a Git tag, the bootstrap SHA uses the source commit recorded in its
[npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/ghq-sector@1.4.0).
Release Please uses that commit as the cutoff for the next changelog.

The normal flow runs `verify` and `release-pr` without OIDC permission. Merging a
release PR updates the version and changelog. GitHub tag and release creation
remain disabled. A separate manual dispatch uses the existing ghq-sector npm
Trusted Publisher to stage the package for owner approval.

## Verification and review

The existing `release.yml` filename is retained. All jobs are restricted to main.
The Release Please job depends on successful full verification and separately
audits its installed tooling. Official `release-please@17.11.2` and its execution
dependencies are locked in the root Bun/npm locks. The distribution Action is
avoided because its bundled lock contains affected dependencies.

Release PR creation uses the existing GITHUB_TOKEN with the existing contents,
issues and pull request permissions. GitHub does not automatically run PR
workflows for PRs created with this token. Before reviewing or merging such a PR,
dispatch **CI** and **Security** on its branch and inspect their final results.
No personal token is added to trigger CI. `release-control.mjs release` rejects
execution before constructing a GitHub client, including on main in Actions;
the former tag/release helper remains disabled.

## Local acceptance

Use Node 24 and Bun 1.3.13. Bun remains the repository manager. Retain its Socket
scanner and three-day minimum release age. No global manager changes are needed.

```sh
bun install --frozen-lockfile
bun install --cwd ui --frozen-lockfile
bun run check
bun run typecheck
bun run --cwd ui typecheck
bun run test
bun run build
bun run audit
bun run pack:check
```

Run `bun run fmt` to apply formatting locally.

`bun run audit` checks the root Bun tree, UI Bun tree and root npm lockfile at the
moderate threshold, including the release tooling. It checks the separate npm
publisher lockfile at the low threshold. The publisher lock records npm's
`libnpmpublish` and its complete installed tree. CI also checks that tree and
exercises the staging request against a local fixture. The stage job requires a
complete audit with zero findings before any submission, then retains the raw audit.

`pack:check` uses `bun pm pack --ignore-scripts` into a temporary directory. It
checks the actual tarball manifest/version, both CLI bin aliases, the built CLI,
UI index/assets and LICENSE, then removes the temporary tarball. It removes npm
and OIDC credentials from the packaging subprocess environment and never calls
a publish command. CI runs it with `--consumer` on the minimum supported Node.js
version to install the tarball with strict engine checks and start the CLI.

## Stage a release

1. Check CI and Security on the exact release PR head, then merge the release PR.
   Record the resulting `main` SHA and the version in the release manifest.
2. Enable the repository variable `GHQ_SECTOR_STAGING_ENABLED` for the release.
   Dispatch `release.yml` on `main` with `prepare_npm_stage=true` and the exact
   `expected_sha` and `expected_version`.
3. Inspect the tarball and `evidence.json` from the successful `verify` job.
   Approve the protected `npm-stage` environment to allow OIDC. The stage job
   checks current `main`, the version, and the SHA-256 output of the verify job.
   It signs provenance and submits the exact bytes from the same run attempt.
4. Compare the submitted package and receipt before approving the stage on
   npm with the maintainer's 2FA. Verify the public tarball integrity,
   provenance source commit, and a fresh consumer install. Set
   `GHQ_SECTOR_STAGING_ENABLED` back to `false` after the stage run.

If the upload outcome is unknown, inspect the npm Staged Packages tab before
retrying. After correcting a known failure, rerun preparation and staging
together for the same source and version.

The [1.4.0 staging record](npm-stage-1.4.0.md) preserves the previous release's
artifact and risk decision. The current workflow requires a clean publisher
audit for every stage.

References: [npm staged publishing](https://docs.npmjs.com/staged-publishing/),
[trusted publishers](https://docs.npmjs.com/trusted-publishers/), and
[libnpmpublish](https://github.com/npm/cli/tree/latest/workspaces/libnpmpublish).
