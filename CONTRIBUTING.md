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
4. Run `npm run build` and commit the updated `dist/index.js` (this will help us actually run it as an action if we wish)
5. Open a PR. Be verbose. We like to read.

## Updating IAM Data

IAM action data is updated automatically via a weekly GitHub Action. To update manually:

```bash
npm run update-iam-data
npm run generate-iam-data
npm run build
```
