# Expand AWS IAM Wildcards

[![CI](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml/badge.svg)](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards/branch/main/graph/badge.svg)](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatically expands IAM wildcard actions in PR diffs and posts inline comments showing what
each wildcard matches, with links to AWS docs.

The goal is to make it easier and faster for reviewers to understand changes to security posture with inline comments
like this:

![screenshot](images/pr-comment-screenshot.png)

## Recommended Workflow

```yaml
# .github/workflows/iam-wildcards.yml
name: Expand IAM Wildcards

on:
  pull_request:

permissions: {}

jobs:
  expand:
    permissions:
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: thekbb/expand-aws-iam-wildcards@79572644d1ee663b60b993bb1e6193c2627312bf # v1.2.0
```

That is the recommended setup:

- trigger on `pull_request`, not `pull_request_target`
- grant only `pull-requests: write` to the job that runs this action
- pin to a full 40-character commit SHA for immutability
- keep the release tag in a trailing comment so humans can see the intended version quickly

No checkout step is required. The action reads the PR diff through the GitHub API and posts inline review comments
back to the pull request.

## What It Does

When your PR introduces:

```hcl
"s3:Get*Tagging",
```

The action posts an inline comment:

> **IAM Wildcard Expansion**
>
> `s3:Get*Tagging` expands to 5 action(s):
>
> 1. [`s3:GetBucketTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 2. [`s3:GetJobTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 3. [`s3:GetObjectTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 4. [`s3:GetObjectVersionTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 5. [`s3:GetStorageLensConfigurationTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)

Consecutive wildcards are grouped into a single comment. Expanded actions link to AWS documentation.
Very large expansions are truncated in the PR comment to stay within GitHub comment limits,
and the full list is written to the workflow run logs.

## Inputs

| Name                  | Description                                          | Default                         |
| --------------------- |------------------------------------------------------| ------------------------------- |
| `github-token`        | GitHub token for API access                          | `${{ github.token }}`           |
| `file-patterns`       | Glob patterns to scan (comma-separated)              | See below                       |
| `collapse-threshold`  | Number of actions before collapsing into `<details>` | `5`                             |

Default file patterns: `**/*.json,**/*.yaml,**/*.yml,**/*.tf,**/*.ts,**/*.js`

## Usage Examples

### Terraform Only

```yaml
- uses: thekbb/expand-aws-iam-wildcards@79572644d1ee663b60b993bb1e6193c2627312bf # v1.2.0
  with:
    file-patterns: '**/*.tf,**/*.tf.json'
```

### CloudFormation Only

```yaml
- uses: thekbb/expand-aws-iam-wildcards@79572644d1ee663b60b993bb1e6193c2627312bf # v1.2.0
  with:
    file-patterns: '**/*.yaml,**/*.yml,**/*.json'
```

## Update Strategy

For security, prefer a full SHA pin over a moving tag such as `@v1`. GitHub recommends full-length commit SHAs as
the immutable option for third-party actions. If you want automatic updates without giving up immutable pins, enable
Dependabot for GitHub Actions in your repository:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'weekly'
```

Dependabot updates workflow `uses:` references in `.github/workflows`, including GitHub Action pins. The trailing
`# v1.2.0` comment is mainly for human review so maintainers can see which release a pinned SHA corresponds to.
Dependabot should keep that comment aligned when it updates the pinned SHA, but the comment is informational,
not security-critical.

## How It Works

1. Fetches the PR diff
1. Scans added lines for IAM wildcard patterns (`service:Action*`)
1. Expands wildcards against the bundled IAM action list generated from [@cloud-copilot/iam-data](https://github.com/cloud-copilot/iam-data)
1. Posts inline review comments with links to AWS docs
1. Reuses or updates existing bot comments in place when the anchor still matches, to reduce comment churn

## Security & Trust

- **Minimal permissions** - only needs `pull-requests: write`
- **No secrets required** - uses the default `github.token`
- **No checkout required** - the action reads PR files through the GitHub API
- **Safer trigger** - use `pull_request` for normal CI and review automation, not `pull_request_target`
- **Immutable pinning available** - prefer a full 40-character commit SHA for production workflows
- **Dependabot-friendly** - GitHub can still raise update PRs for SHA-pinned action references
- **Auditable** - the TypeScript source is small and `dist/index.js` is committed
- **No runtime dependency fetches** - IAM action data is bundled at build time and refreshed in this repo separately

```yaml
uses: thekbb/expand-aws-iam-wildcards@79572644d1ee663b60b993bb1e6193c2627312bf # v1.2.0
```

Use `@v1` only if you deliberately prefer the convenience of a moving major tag over an immutable release pin.

```yaml
uses: thekbb/expand-aws-iam-wildcards@v1
```

## Verify a Release Pin

All release tags in this repository are signed with the GPG key whose public half is published at
[`keys/release-signing-key.asc`](keys/release-signing-key.asc).

Fingerprint:

```text
353A AFB2 1CE8 1D84 3634 AD3E DE52 EEA6 AF0D 8779
```

Import the armored public key locally before verifying a release pin:

This repo includes a helper script at the repository root:

```bash
gpg --import keys/release-signing-key.asc
gpg --show-keys --fingerprint keys/release-signing-key.asc
./verify-release.sh --tag v1.2.0
./verify-release.sh --sha 79572644d1ee663b60b993bb1e6193c2627312bf
```

`--tag` must be a semver release tag with a leading `v`. `--sha` must be a full 40-character commit SHA. The script
derives the other value automatically, verifies the signed semver tag locally, confirms the tag resolves to the same
commit, and checks that the commit is on `main`.

For an additional cross-check, you can confirm the same public key is published on
`keys.openpgp.org` for `kevin@thekbb.net`:

```bash
gpg --keyserver hkps://keys.openpgp.org --search-keys kevin@thekbb.net
```

The fingerprint should still match exactly:

```text
353A AFB2 1CE8 1D84 3634 AD3E DE52 EEA6 AF0D 8779
```

You can also point it at a fork or a local clone by overriding `REPO_URL`:

```bash
REPO_URL=https://github.com/your-org/expand-aws-iam-wildcards.git ./verify-release.sh --tag v1.2.0
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## Credits

Uses [@cloud-copilot/iam-data](https://github.com/cloud-copilot/iam-data) for fresh AWS IAM data.
