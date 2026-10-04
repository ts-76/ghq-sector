# Manual staging of ghq-sector 1.4.0

This proposal adds a manual, one-version publication route. Ordinary pushes and
release PR merges still cannot tag or publish. The existing application, UI and
release-tool audits retain their moderate threshold and must pass with zero
findings before packaging. The publishing CLI is a separate locked tool.

## Remaining publisher risks

Official npm 12.2.0 contains http-cache-semantics 4.2.0, brace-expansion 5.0.9,
ip-address 10.5.0 and undici 6.28.0. The 2026-10-04 audit reports four packages
(three high, one moderate), representing eleven advisories; the previous audit
reported eighteen additional propagated entries. No dependency was repaired by
that count change. The complete, version-specific scope is recorded in
`tools/publisher/risk-scope.json`, with the official npm tarball's integrity in
its separate lockfile. No project advisory is suppressed.

Credential-free dry-runs of publish and stage publish passed on Node 24.19.0
using a fixed verified tarball, scripts disabled, fresh caches, no proxy and
mocked metadata. Neither exercised OIDC, provenance signing or actual upload.
Static inspection of npm's authentication and signing source shows no cachePath
on the OIDC token GET/signing fetch, POST for token exchange and stage upload,
and GET/HEAD-only caching in make-fetch-happen. This reduces applicability of
the cache advisory to those paths but is not live authentication evidence.
An additional isolated probe executed npm's OIDC helper, token-exchange call,
Sigstore's GitHub token helper and provenance-payload generation with synthetic
credentials and mocked transport/signing. It confirmed the npm/sigstore
audiences, POST exchange scoped to ghq-sector, no cachePath on token GETs,
Sigstore's independent two retries, and source/workflow/artifact bindings in
the payload. Real tokens, certificates, signature validation and upload were
not exercised by this probe.
The HTTP-cache advisory is disputed by its maintainer and remains in GitHub's
database. http-cache-semantics 4.3.0 does not change the max-stale path.

The workflow requires explicit owner acceptance of these residual risks for
1.4.0 only. This is a scoped exception, not an audit-zero claim. Unknown
advisories, other packages, critical findings, changed bundled versions and
other ghq-sector versions fail. Raw publisher audit results are retained.

## Activation and identity

Until both GitHub gates are enabled, staging remains disabled:

1. Review and merge the implementation through normal required checks/review.
2. GitHub environment `npm-stage`: required reviewer User ts-76 (108617014),
   self-review allowed for solo maintenance, admin bypass disabled, custom
   deployment branch policy allowing only branch `main`. Set repository
   variable `GHQ_SECTOR_STAGING_ENABLED=true` after owner approval.

The existing **ghq-sector** npm Trusted Publisher was verified on 2026-10-04:
owner `ts-76`, repository `ghq-sector`, workflow `release.yml`, no environment
constraint, permission for publish and stage publish. This path preserves that
identity and needs no npm permission change or long-lived npm token. Only the
protected stage job receives id-token:write; the script invokes stage publish.

Dispatch `Release` on main with `prepare_npm_stage=true` and the exact reviewed
40-character main SHA. Leave publisher_risk_consent false for preparation only;
set it true only after accepting the documented one-version risks. The verify
job runs full audits, lint, types, Svelte checks, tests, build and pack validation,
then creates one artifact. Stage downloads that same run/attempt's artifact;
it never rebuilds or repacks. Source SHA, version, SHA256 and SHA512 integrity
are checked before submission, and current main must still match. The original
accepted tarball's SHA256 is also pinned in risk-scope.json:
`4e397782bed9c417e1d62a316977888fecb2930035c00ad5eed75522c4cabc06`.
Local preparation reproduced both its exact bytes and seven file contents.
A CI build producing different bytes fails rather than silently replacing it. Changed
source or an earlier attempt fails. Node and npm versions are pinned.

Publishing uses scripts disabled, a new initially empty cache, explicit empty
user/global npm configs, a token/proxy-free environment apart from Actions
OIDC, fixed npm registry, provenance enabled and registry retries disabled.
Sigstore's GitHub OIDC helper independently allows two retries; npm's
fetch-retries option does not override that helper. Library redirect handling
also remains enabled. These authenticated/signing paths have only been
inspected statically and are included in the one-version risk decision. Necessary
OIDC/registry/Sigstore traffic is real; the offline fixture's complete network
block cannot be retained. Live OIDC/provenance success remains unverified until
an authorized stage run completes.

## Owner review and recovery

The workflow submits a stage only. It never approves a stage, changes dist-tags,
creates a Git tag or GitHub Release, or uses another package's credentials.
The owner must inspect/download the stage and compare its integrity/SHA256
with `evidence.json` / `npm-stage-receipt.json`, then personally approve with npm
2FA. After approval, verify public registry bytes and an external consumer.

Do not retry an unknown upload outcome blindly. Inspect the npm Staged Packages
tab first; a failed receipt check after submission can leave a real pending
stage. On a known failed authentication attempt, correct the ghq-sector-specific
trust configuration and rerun the entire workflow so preparation and staging
share one run attempt. Never reuse an earlier attempt's artifact. After 1.4.0
is public, the duplicate-version gate rejects submission and the risk scope
does not authorize any later release.

Official references: [npm staged publishing](https://docs.npmjs.com/staged-publishing/),
[trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[HTTP-cache advisory](https://github.com/advisories/GHSA-ch52-4w7c-c8xp),
[maintainer response](https://github.com/kornelski/http-cache-semantics/issues/56#issuecomment-5975759591).
