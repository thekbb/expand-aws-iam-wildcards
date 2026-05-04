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

1. Make sure `main` already contains the changelog entry and source changes you want in the
   release.
2. Set the release variables:

   ```bash
   VERSION=1.2.5
   TAG="v$VERSION"
   MAJOR_TAG="v${VERSION%%.*}"
   ```

3. Run `Prepare Release` from `main`:

   ```bash
   gh workflow run prepare-release.yml -f version="$VERSION"
   run_id="$(gh run list --workflow prepare-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   gh run watch "$run_id"
   ```

4. Review and merge the resulting `release-candidate/$TAG` pull request.

5. After that PR is merged, create and push the signed release tag and the movable major tag:

   ```bash
   old_major_tag="$(git ls-remote --refs --tags origin "refs/tags/$MAJOR_TAG" | awk '{print $1}')"
   git fetch origin main --tags
   git tag -s "$TAG" origin/main -m "$TAG"
   git tag -s -f "$MAJOR_TAG" origin/main -m "$MAJOR_TAG"
   git push origin "refs/tags/$TAG"
   git push --force-with-lease="refs/tags/$MAJOR_TAG:$old_major_tag" origin "refs/tags/$MAJOR_TAG"
   ```

6. Create the draft GitHub release:

   ```bash
   gh release create "$TAG" --draft --verify-tag --generate-notes
   gh release view "$TAG" --json isDraft,tagName,url
   ```

7. Run `Verify Draft Release` from the release tag itself:

   ```bash
   gh workflow run verify-draft-release.yml --ref "$TAG" -f tag="$TAG"
   run_id="$(gh run list --workflow verify-draft-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   gh run watch "$run_id"
   ```

   That workflow verifies the signed tag, rebuilds `dist/index.js` on Ubuntu, attests the bundle,
   and dispatches `Publish Verified Release` if verification succeeds.

8. Check that the release is now published and immutable:

   ```bash
   gh release view "$TAG" --json isDraft,isImmutable,isPrerelease,tagName,targetCommitish,url
   ```

9. Run the local verification script at the end:

   ```bash
   ./verify-release.sh --tag "$TAG"
   ```

If you need the keys, import them

   ```bash
   gpg --import keys/release-signing-key.asc
   gpg --show-keys --fingerprint keys/release-signing-key.asc
   ```
