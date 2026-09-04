# Contributing

Thank you for your interest in contributing!

## Development

```bash
# Install dependencies
npm install

# Run the same checks as the main CI job
npm run check

# Run tests
npm test

# Run tests with the CI coverage configuration
npm run test:coverage

# Check action metadata and README examples
npm run docs:check

# Type check
npm run typecheck

# Lint
npm run lint
npm run lint:md

# Build
npm run build

# Rebuild twice and compare without changing dist/
npm run build:check

# Build temporarily and run compiled smoke and mocked-API integration tests
npm run build:smoke
```

`npm run typecheck` checks production code, release tooling, and tests with the
same strict TypeScript configuration.

`npm run docs:check` keeps README input names, defaults, example inputs, and the
runtime entry aligned with `action.yml` and `package.json`.

Diff processing models every matching file as analyzed, binary, empty, missing
patch text, or failed analysis. An absent API patch is never guessed to be
binary because GitHub can also omit large text patches. Missing and failed
patches are retried from the full pull-request diff. If retrieval fails or the
full diff is incomplete, partial findings remain usable but stale-comment
deletion is disabled for that run. Tests for this boundary must cover mixed
states, explicit binary data, malformed patches, renames, removals, quoted
paths, fallback permissions and truncation, and protected stale comments.

Each build copies the TypeScript source into an ignored workspace, replaces the
tracked IAM modules there with data from the locked
`@cloud-copilot/iam-data` package, validates the catalog, and compiles through
the repository-local `ncc` executable. The workspace is removed afterward.
`npm run build` replaces `dist/index.js` only after that isolated build succeeds.
`npm run build:check` rebuilds twice and compares both results with the
committed bundle without modifying `dist/`. `npm run build:smoke` builds
temporarily, executes the entry declared by `action.yml` with a synthetic
non-PR event, then exercises the compiled review lifecycle against a stateful
local GitHub API fixture. It cleans up without changing `dist/`.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run check`
4. Open a PR. Be verbose. We like to read.

## Integration Test

This repository includes a source-level mocked GitHub integration test in
[`src/integration.test.ts`](src/integration.test.ts) and a compiled-runtime
integration harness in [`scripts/compiled-integration.ts`](scripts/compiled-integration.ts).

The source test runs as part of `npm test` against a stateful mocked Octokit
client. The compiled harness runs as part of `npm run build:smoke` against a
local HTTP server. Together they cover pagination, comment creation, unchanged
reruns, updates, stale cleanup, truncation, and no-op behavior through both the
TypeScript modules and the generated action entry point.

The manual `End-to-End Test` workflow lives in the dedicated
[`thekbb/expand-aws-iam-wildcards-e2e`](https://github.com/thekbb/expand-aws-iam-wildcards-e2e)
fixture repository and runs only from its `main` branch. It accepts a full
commit SHA from this repository's `main` history, checks out and builds that
exact source, and runs the compiled action against the real GitHub API. It
verifies creation, unchanged reruns, in-place updates, stale cleanup, and reply
preservation. It also follows a representative AWS documentation link and
requires its native action anchor. An `always()` cleanup step closes the pull
request and deletes its branch.

Before its first run, enable `Allow GitHub Actions to create and approve pull
requests` under the fixture repository's Actions settings. Run `End-to-End
Test` there with its `main` branch selected and provide the source commit as
`source_sha`. The workflow uses only a job-scoped `GITHUB_TOKEN` with write
access to the fixture repository; it does not require source-repository write
access, a PAT, or a repository secret.

The fixture branch is named `e2e/run-<run-id>-<attempt>`. If a runner-level
cancellation prevents the cleanup step from running, close the draft fixture
pull request and delete that exact branch manually.

Generated review comments include a versioned HTML marker used for machine
identity. The visible heading remains part of the legacy migration contract;
change either marker only with collision, migration, and synchronization tests.

Existing-comment discovery requires both a recognized comment shape and the
author identity resolved from the configured token. PAT identity is resolved
through GitHub's authenticated-user endpoint; GitHub Actions and GitHub App
installation tokens fall back to GraphQL's viewer identity. User-authored
collisions, comments from other bots, malformed markers, ambiguous markers,
and unsupported marker versions remain unmanaged. Legacy comments are accepted
only when their visible body matches a generated shape, then updated with the
current machine marker when their diff anchor is reused.

## Updating IAM Data

IAM data is updated through normal dependency pull requests. Dependabot may
raise `@cloud-copilot/iam-data` updates, and those pull requests should show the
exact version in both `package.json` and `package-lock.json`.

Generated IAM catalog modules are not committed. A dependency update pull
request changes dependency metadata and proves the generated catalog still
passes the source and bundle checks.

Installation and the full check suite generate ignored source modules from the
currently locked package for TypeScript analysis and source tests:

```bash
npm run generate-iam-data
```

To inspect generated modules outside `src/`, provide a repository-local or
temporary output directory:

```bash
npm run generate-iam-data -- --output-dir /tmp/expand-aws-iam-data
```

Generation from one locked IAM-data package is byte-for-byte deterministic.
Generated catalogs must retain sorted, unique, well-formed actions, complete
service documentation mappings, conservative count floors, and representative
expansion and link behavior.

Release preparation does not select a new IAM-data version. It installs from the
reviewed lockfile, verifies the installed package against package metadata,
validates and reports catalog counts, and runs the release checks and bundle
build with that clean installation.

The release build does not bundle the ignored source copies. It generates and
validates the same locked catalog independently inside its isolated workspace.

## Preparing a Release

Release bundles are generated on Ubuntu through GitHub Actions rather than being committed from a local machine.
Releases originate from `main`; the `release-candidate/$TAG` branch is a temporary review branch created by the
prepare workflow.

The `main` branch ruleset must require signed commits and must not let release
automation bypass that requirement. Merge release-candidate pull requests in
the GitHub interface so GitHub creates the signed merge commit.

Before creating a version tag, the release command resolves the candidate pull
request's exact merge SHA and checks its GitHub signature record. The commit
must be valid, signed by GitHub's `web-flow` signer, and use an approved GitHub
web-flow signing key. The currently approved key ID is
`B5690EEEBB952194`.

The version and major tags must be signed by release key fingerprint
`353AAFB21CE81D843634AD3EDE52EEA6AF0D8779`. Hosted publication and the local
verifier enforce that fingerprint through `scripts/verify-release-tag.sh`.
Rotate the key only by updating the published key, verifier, and security
documentation together before using the replacement key.

If GitHub rotates that key, verify the new key against
[GitHub's published web-flow key](https://github.com/web-flow.gpg) and a known
GitHub-created merge commit before adding its ID to the allowlist in
`scripts/verify-github-commit.sh`. Do not bypass the signature check to
complete a release.

### Prerequisites

The release command requires an authenticated GitHub CLI and the documented
release signing key in the local GPG keyring. If necessary, import the key:

```bash
gpg --import keys/release-signing-key.asc
gpg --show-keys --fingerprint keys/release-signing-key.asc
```

Start from a clean `main` branch containing the complete `[UNRELEASED]`
changelog. The command verifies that local `main` matches `origin/main`, the
signing key is available, and the requested version, tag, and release-candidate
branch do not conflict with existing release state.

### Run a Release

Set the semantic version without a leading `v`, then run the release command:

```bash
VERSION=2.1.0
npm run release -- "$VERSION"
```

The command dispatches `Prepare Release` and watches it to completion. That
workflow installs from the lockfile, reports the IAM-data version and catalog
counts, runs the release checks, finalizes the changelog, updates package
metadata, builds `dist/index.js` on Ubuntu, and opens
`release-candidate/v$VERSION`. The candidate is limited to `CHANGELOG.md`,
`dist/index.js`, `package.json`, and `package-lock.json`.

Review and merge that pull request in the GitHub interface. Return to the
release command and press Enter. If the original command is no longer running,
resume it after the merge:

```bash
npm run release -- "$VERSION" --continue
```

The continuation synchronizes local `main`, resolves and verifies the exact
release-candidate merge commit, creates the signed version tag, creates the
draft release, and dispatches `Verify and Publish Release`. Its verification
job has read-only source access, rebuilds and compares the bundle, verifies the
commit and tag signatures, and attests `dist/index.js`. A dependent publication
job repeats the release-subject checks, verifies the attestation, publishes
with its job-scoped `GITHUB_TOKEN`, and confirms the release is immutable. The
command then runs the standalone verifier, moves the signed major tag with
force-with-lease, verifies its target, and prints the supported consumer
references.

The release commit's `.github/workflows` tree must match current `main`. The
release command checks this before creating the version tag, and the hosted
workflow checks it again before publishing. GitHub does not allow its workflow
token to update a release whose target contains workflow changes outside the
default branch.

If the changelog was finalized before running release preparation, use:

```bash
npm run release -- "$VERSION" --no-finalize-changelog
```

### Resume or Recover

The release command is safe to rerun for the same version. Before the candidate
pull request is merged, rerun the normal command to refresh it from `main`.
After it is merged, use `--continue`. Existing matching tags, draft releases,
and immutable releases are recognized so the command can continue from the
latest completed checkpoint.

If completing a failed release requires a source or workflow change, do not
move its version tag. Merge the fix and release the next patch version instead.
The failed exact version remains unpublished, and the signed major tag stays on
the latest successfully published release.

Do not manually bypass a failed signature, ancestry, metadata, attestation, or
immutability check. Fix the reported state and rerun the command. Never rewrite
an exact semantic version tag or immutable release.
