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

## Updating IAM Data

IAM action data is updated automatically via a weekly GitHub Action. To update manually:

```bash
npm run update-iam-data
npm run build
```

## Preparing a Release

Release bundles are generated on Ubuntu through GitHub Actions rather than being committed from a local machine.

1. Make sure the source branch already contains any changelog or source changes you want in the release.
2. Run the `Prepare Release` workflow with the source ref and target version.
3. Review the resulting `release-candidate/vX.Y.Z` pull request and merge it.
4. Create and push a signed `vX.Y.Z` tag from the merged release-candidate commit.
5. Create a draft GitHub release for that tag.
6. Run the `Verify Draft Release` workflow with that tag.
7. If verification succeeds, the workflow will attest the bundle and publish the draft release.
