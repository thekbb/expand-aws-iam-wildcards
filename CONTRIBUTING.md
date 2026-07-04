# Contributing

Thank you for your interest in contributing!

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
npm run lint:md

# Build
npm run build
```

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test`, `npm run lint`, and `npm run lint:md`
4. Open a PR. Be verbose. We like to read.

## Integration Test

This repository includes a mocked GitHub integration test in
[`src/integration.test.ts`](src/integration.test.ts).

It runs as part of the normal `npm test` suite and exercises the real action flow against a
stateful mocked Octokit client. It verifies that a pull request diff containing an IAM wildcard
produces the expected inline review comment on the first run and reuses that same comment unchanged
on the second run.

## Updating IAM Data

IAM action data is updated automatically via a weekly GitHub Action. To update manually:

```bash
npm run update-iam-data
npm run build
```

## Preparing a Release

Release bundles are generated on Ubuntu through GitHub Actions rather than being committed from a local machine.
Releases originate from `main`; the `release-candidate/$TAG` branch is a temporary review branch created by the
prepare workflow.

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
   ! git ls-remote --exit-code --heads origin "$BRANCH"
   ```

   Instead of running the preflight checks and `Prepare Release` commands manually, use the release script. It waits
   after the release preparation PR is ready for review; after you merge that PR, press Enter to continue the release.
   By default, the release preparation PR finalizes the changelog with the requested version, date, and compare links.
   If the changelog was already finalized manually, pass `--no-finalize-changelog`.

   ```bash
   scripts/release.sh "$VERSION"
   ```

   ```bash
   scripts/release.sh "$VERSION" --no-finalize-changelog
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

   If you stopped the script after creating the release preparation PR, resume after merging the pull request:

   ```bash
   scripts/release.sh "$VERSION" --continue
   ```

   If you use the release script, skip the remaining manual steps.

5. After that PR is merged, resolve its exact merge commit, then create and push the signed release tag. Do not tag
   the latest `main` by name because another PR could merge between these steps.

   ```bash
   pr_state="$(gh pr view "$BRANCH" --json state --jq '.state')"
   test "$pr_state" = MERGED
   release_sha="$(gh pr view "$BRANCH" --json mergeCommit --jq '.mergeCommit.oid')"
   git fetch origin main --tags
   git merge-base --is-ancestor "$release_sha" origin/main
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

   That workflow verifies the signed tag, rebuilds `dist/index.js` on Ubuntu, attests the bundle,
   and dispatches `Publish Verified Release` if verification succeeds.

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
