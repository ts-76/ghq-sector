# Release PRs and publication pause

Release Please replaces semantic-release. Ordinary main commits maintain a
version/changelog release PR only after the main commit passes verification.
The manifest and package start at the already published 1.3.0; the bootstrap
commit is the existing v1.3.0 commit, so older changes are not proposed again.

**Automatic GitHub tags/releases and npm publication are disabled.** The user
chose to land dependency updates first without an unauditable publishing tool.
The workflow has only `verify` and `release-pr` jobs, and no OIDC permission.
Merging a release PR can update version/changelog files, but creates no tag or
published package. Review release PRs as proposals; restore publication in a
separate reviewed change before using them to release a version. Nothing here
changes npm trusted publisher settings or creates credentials.

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
the former tag/release helper and publishing CLI are removed.

## Local acceptance

Use Node 24 and Bun 1.3.13. Bun remains the repository manager; retain its Socket
scanner and three-day minimum release age. No global manager changes are needed.

```sh
bun install --frozen-lockfile
bun install --cwd ui --frozen-lockfile
bun run lint
bun run typecheck
bun run --cwd ui typecheck
bun run test
bun run build
bun run audit
bun run pack:check
```

`bun run audit` checks the root Bun tree, UI Bun tree and root npm lockfile at the
existing moderate threshold, including the release tooling. No advisory is
ignored. There is no installed or runnable project-owned npm publisher to omit
from these audits.

`pack:check` uses `bun pm pack --ignore-scripts` into a temporary directory. It
checks the actual tarball manifest/version, both CLI bin aliases, the built CLI,
UI index/assets and LICENSE, then removes the temporary tarball. It removes npm
and OIDC credentials from the packaging subprocess environment and never calls
a publish command. This is a package-content check, not a publish/authentication
dry run. Actual npm OIDC authentication remains untested.

## Why publication remains disabled (2026-10-03)

The actual official npm 11.20.0 and 11.21.0 publisher installations each audit at
24 affected entries (23 high, one moderate), including dependent packages. There
are four directly affected bundles: brace-expansion 5.0.9, ip-address 10.5.0,
undici 6.28.0 and http-cache-semantics 4.2.0. The previously inspected npm 12.2.0
bundles the same affected copies. Consumer overrides and `npm audit fix` do not
replace npm's bundled dependencies.

The [http-cache-semantics advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)
currently lists no patched release, and its
[upstream issue](https://github.com/kornelski/http-cache-semantics/issues/56) is open.
A minor or major CLI upgrade therefore does not make publication auditable.
The candidate npm 11.21.0 also had not reached the repository's three-day release
age at verification time; it was tested in an isolated research directory and
was not promoted to the project. Rebuilding or forking npm would still need a
reviewed fix for the unpatched dependency and is not part of this change.

A future publication PR must introduce an audited publisher, lock and audit the
actual executed dependency tree, test package creation and release recovery,
verify tags are bound to the checked SHA/version, and preserve the existing
trusted publisher workflow identity without adding tokens or permissions.
Keep all acceptance/audit gates before any tag or publication. Restoring a
publisher is an explicit implementation change; ordinary main or release-PR
merges cannot enable it.
