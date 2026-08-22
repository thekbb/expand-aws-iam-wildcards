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

If GitHub rotates that key, verify the new key against
[GitHub's published web-flow key](https://github.com/web-flow.gpg) and a known
GitHub-created merge commit before adding its ID to the allowlist in
`scripts/release/github.ts`. Do not bypass the signature check to complete a
release.

1. Set the release variables:

   ```bash
   set -euo pipefail
   VERSION=1.2.5
   TAG="v$VERSION"
   MAJOR_TAG="v${VERSION%%.*}"
   BRANCH="release-candidate/$TAG"
   ```

2. Run the release preflight checks. `main` must already contain the changelog entry and source changes you want in
   the release.

   ```bash
   gh auth status
   printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
   test "$(git branch --show-current)" = main
   git fetch origin main --tags
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   test -z "$(git status --porcelain)"
   test -n "$(git config --get user.signingkey)"
   gpg --list-secret-keys "$(git config --get user.signingkey)"
   grep -q "^## \\[UNRELEASED\\]" CHANGELOG.md
   ! git rev-parse -q --verify "refs/tags/$TAG"
   ! git ls-remote --exit-code --tags origin "$TAG"
   ```

   Instead of running the preflight checks and `Prepare Release` commands manually, use the release command. It waits
   after the release preparation PR is ready for review; after you merge that PR, press Enter to continue the release.
   By default, the release preparation PR finalizes the changelog with the requested version, date, and compare links.
   If the changelog was already finalized manually, pass `--no-finalize-changelog` after the npm argument separator.

   ```bash
   npm run release -- "$VERSION"
   ```

   ```bash
   npm run release -- "$VERSION" --no-finalize-changelog
   ```

3. Run `Prepare Release` from `main`:

   ```bash
   run_name="Prepare $TAG"
   previous_run_id="$(gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 \
     --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" | head -n 1)"
   gh workflow run prepare-release.yml -f version="$VERSION"
   run_id=''
   for _ in {1..30}; do
     sleep 2
     run_id="$(gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 \
       --json databaseId,displayTitle --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" | head -n 1)"
     [[ -n "$run_id" && "$run_id" != "$previous_run_id" ]] && break
   done
   test -n "$run_id"
   test "$run_id" != "$previous_run_id"
   gh run watch "$run_id" --exit-status
   ```

4. Review and merge the resulting `$BRANCH` pull request.

   Rerunning `Prepare Release` for the same version refreshes the existing open
   pull request from `main`. The workflow limits the candidate commit to
   `CHANGELOG.md`, `dist/index.js`, `package.json`, and `package-lock.json`.

   If you stopped the script after creating the release preparation PR, resume after merging the pull request:

   ```bash
   npm run release -- "$VERSION" --continue
   ```

   If you use the release command, skip the remaining manual steps.

5. After that PR is merged, resolve its exact merge commit, then create and push the signed release tag. Do not tag
   the latest `main` by name because another PR could merge between these steps.

   ```bash
   pr_state="$(gh pr view "$BRANCH" --json state --jq '.state')"
   test "$pr_state" = MERGED
   release_sha="$(gh pr view "$BRANCH" --json mergeCommit --jq '.mergeCommit.oid')"
   git fetch origin main --tags
   git merge-base --is-ancestor "$release_sha" origin/main
   signature_query='
   query($owner: String!, $name: String!, $oid: GitObjectID!) {
     repository(owner: $owner, name: $name) {
       object(oid: $oid) {
         ... on Commit {
           oid
           signature {
             isValid
             signer { login }
             state
             wasSignedByGitHub
             ... on GpgSignature { keyId }
           }
         }
       }
     }
   }'
   signature_filter='
   .data.repository.object
   | [
       .oid,
       .signature.isValid,
       .signature.state,
       .signature.wasSignedByGitHub,
       .signature.signer.login,
       .signature.keyId
     ]
   | @tsv'
   signature_record="$(gh api graphql \
     -f query="$signature_query" \
     -f owner=thekbb \
     -f name=expand-aws-iam-wildcards \
     -f oid="$release_sha" \
     --jq "$signature_filter")"
   expected_signature_record="$release_sha"$'\ttrue\tVALID\ttrue\tweb-flow\tB5690EEEBB952194'
   test "$signature_record" = "$expected_signature_record"
   git tag -s "$TAG" "$release_sha" -m "$TAG"
   git push origin "refs/tags/$TAG"
   ```

6. Create the draft GitHub release:

   ```bash
   gh release create "$TAG" --draft --verify-tag --generate-notes
   gh release view "$TAG" --json isDraft,tagName,url
   ```

7. Run `Verify Draft Release` from the release tag itself:

   ```bash
   run_name="Verify $TAG"
   previous_run_id="$(gh run list --workflow verify-draft-release.yml --event workflow_dispatch --branch "$TAG" \
     --limit 50 --json databaseId,displayTitle \
     --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" | head -n 1)"
   gh workflow run verify-draft-release.yml --ref "$TAG" -f tag="$TAG"
   run_id=''
   for _ in {1..30}; do
     sleep 2
     run_id="$(gh run list --workflow verify-draft-release.yml --event workflow_dispatch --branch "$TAG" \
       --limit 50 --json databaseId,displayTitle \
       --jq ".[] | select(.displayTitle == \"$run_name\") | .databaseId" | head -n 1)"
     [[ -n "$run_id" && "$run_id" != "$previous_run_id" ]] && break
   done
   test -n "$run_id"
   test "$run_id" != "$previous_run_id"
   gh run watch "$run_id" --exit-status
   ```

   That workflow verifies the signed tag, rebuilds `dist/index.js` on Ubuntu,
   attests the bundle, and immediately verifies that the provenance names the
   exact repository, workflow, tag ref, and tag commit before dispatching
   `Publish Verified Release`.

8. Check that the release is now published and immutable:

   ```bash
   gh release view "$TAG" --json isDraft,isImmutable,isPrerelease,tagName,targetCommitish,url
   ```

9. Run the local verification script:

   ```bash
   ./verify-release.sh --tag "$TAG"
   ```

10. After publication and verification succeed, move the signed major tag to the release commit:

    ```bash
    old_major_tag="$(git ls-remote --refs --tags origin "refs/tags/$MAJOR_TAG" | awk '{print $1}')"
    git tag -s -f "$MAJOR_TAG" "$TAG^{commit}" -m "$MAJOR_TAG"
    git push --force-with-lease="refs/tags/$MAJOR_TAG:$old_major_tag" origin "refs/tags/$MAJOR_TAG"
    ```

The release process is safe to resume from the latest completed checkpoint:

1. release variables set and preflight checks passed
2. prepare workflow dispatched
3. release preparation pull request created from `$BRANCH`
4. release preparation pull request reviewed and merged into `main`
5. signed version tag pushed to the release preparation PR merge commit
6. draft release created for `$TAG`
7. draft release verified from the tag ref
8. release published and immutable
9. local release verification passed
10. signed major tag moved to the release commit

If you need the keys, import them

   ```bash
   gpg --import keys/release-signing-key.asc
   gpg --show-keys --fingerprint keys/release-signing-key.asc
   ```
