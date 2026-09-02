# Expand AWS IAM Wildcards

[![CI](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml/badge.svg)](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards/branch/main/graph/badge.svg)](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An IAM wildcard in a pull request can hide a much larger permission change.
This action expands wildcards added by the pull request and posts an inline
comment listing the matching AWS actions.

This action reads the PR diff through the GitHub API and links each result to the AWS
Service Authorization Reference. It does not need AWS credentials or check out
the repository.

![Example IAM wildcard expansion comment](images/pr-comment-screenshot.png)

## Quick start

Add this workflow to the repository where you want IAM wildcard review:

```yaml
# .github/workflows/iam-wildcards.yml
name: Expand IAM Wildcards

on:
  pull_request:

permissions: {}

concurrency:
  group: iam-wildcards-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  expand:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: thekbb/expand-aws-iam-wildcards@v2.0.0
```

No checkout step or repository secret is needed. Use `pull_request`, not
`pull_request_target`, and grant `pull-requests: write` only to this job.

## What gets commented

For example, if a PR adds:

```hcl
"s3:Get*Tagging",
```

the action leaves an inline comment:

> **IAM Wildcard Expansion**
>
> `s3:Get*Tagging` expands to 5 action(s):
>
> 1. [`s3:GetBucketTagging`][s3-get-bucket-tagging]
> 2. [`s3:GetJobTagging`][s3-get-job-tagging]
> 3. [`s3:GetObjectTagging`][s3-get-object-tagging]
> 4. [`s3:GetObjectVersionTagging`][s3-get-object-version-tagging]
> 5. [`s3:GetStorageLensConfigurationTagging`][s3-get-storage-lens-configuration-tagging]

<!-- markdownlint-disable MD013 -->
[s3-get-bucket-tagging]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html#list_s3-action-GetBucketTagging
[s3-get-job-tagging]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html#list_s3-action-GetJobTagging
[s3-get-object-tagging]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html#list_s3-action-GetObjectTagging
[s3-get-object-version-tagging]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html#list_s3-action-GetObjectVersionTagging
[s3-get-storage-lens-configuration-tagging]: https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html#list_s3-action-GetStorageLensConfigurationTagging
<!-- markdownlint-enable MD013 -->

Consecutive wildcard lines are grouped into one comment. Running the workflow
again updates its existing comments instead of adding duplicate threads.

## What it scans

The action looks for `service:action` strings on added lines in matching files.
It understands both IAM wildcard characters:

- `*` matches zero or more characters, as in `ec2:Describe*`
- `?` matches one character, as in `sqs:?etQueueAttributes`

Matching is case-insensitive. Because the action scans added text, it can report
patterns used in either `Action` or `NotAction`.

This is not a policy parser. It does not:

- inspect unchanged lines
- analyze resource wildcards, conditions, or effective permissions
- interpret the effect of `Allow`, `Deny`, or `NotAction`
- replace IAM Access Analyzer or your own policy tests

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `github-token` | GitHub token for API access | `${{ github.token }}` |
| `file-patterns` | Comma-separated glob patterns to scan | `**/*.json,**/*.yaml,**/*.yml,**/*.tf,**/*.ts,**/*.js` |
| `collapse-threshold` | Number of expanded actions before collapsing into details element | `5` |

`file-patterns` is a positive include list. It does not support ordered
`!pattern` exclusions.

## Examples

### Terraform only

```yaml
- uses: thekbb/expand-aws-iam-wildcards@v2.0.0
  with:
    file-patterns: '**/*.tf,**/*.tf.json'
```

### CloudFormation only

```yaml
- uses: thekbb/expand-aws-iam-wildcards@v2.0.0
  with:
    file-patterns: '**/*.yaml,**/*.yml,**/*.json'
```

## Troubleshooting

### No comments were posted

Confirm that the PR adds a wildcard action in a file matched by
`file-patterns`. Existing lines, resource wildcards, and patterns with no
matching AWS action are ignored.

### The action cannot post a comment

Confirm that its job has `pull-requests: write`. The default `github-token`
uses only the permissions granted to the job.

### Diff analysis was incomplete

GitHub may omit patch text for large or unusual files. The action retries using
the full PR diff. If files remain unresolved, it reports a warning, keeps valid
findings, and preserves stale comments rather than deleting potentially useful
review history.

### An expansion was truncated

Very large expansions are shortened to fit GitHub's comment limit. The complete
action list is written to the workflow run logs.

## Version pinning

For most repositories, use an exact semantic release such as `@v2.0.0` and
enable Dependabot for GitHub Actions. Releases in this repository are
[immutable][immutable-releases] starting with `v1.2.1`, while semantic version
references remain eligible for [Dependabot alerts and updates][dependabot-alerts].

A full 40-character commit SHA is the strongest direct pin, but GitHub does not
currently provide Dependabot security alerts for SHA-pinned Actions. SHA users
must monitor advisories another way. This is the second-best way to consume the
action. Add a semantic version comment after the SHA, so
Dependabot can keep the human-readable version up to date.

For `v2.0.0`, that looks like:

```yaml
- uses: thekbb/expand-aws-iam-wildcards@3f24ae0bed4f39f34f68e0da355e6c1180c83cb6 # v2.0.0
```

Use `@v2` when you deliberately want the latest compatible release without a
workflow-file update. The signed major tag moves only after the corresponding
release is verified, published, and immutable.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule:
      interval: 'weekly'
```

## Security

- The action needs only `pull-requests: write` and the default GitHub token.
- It does not check out PR code, launch processes, or evaluate PR content as
  code.
- It does not fetch IAM data or dependencies at runtime.
- `dist/index.js` is committed so the shipped JavaScript can be reviewed.
- Release tags are GPG-signed.
- Release bundles are rebuilt on a GitHub-hosted Ubuntu runner and receive a
  [GitHub artifact attestation][artifact-attestations].
- Published version releases are [immutable][immutable-releases].

See [SECURITY.md](SECURITY.md) for vulnerability reporting and the runtime trust
model.

## Verifying a release

[`verify-release.sh`](verify-release.sh) checks the signed tag, GitHub-signed
release commit, immutable release, and `dist/index.js` build attestation:

```bash
gpg --import keys/release-signing-key.asc
gh auth status
./verify-release.sh --tag v2.0.0
```

The approved release-key fingerprint is:

```text
353A AFB2 1CE8 1D84 3634 AD3E DE52 EEA6 AF0D 8779
```

For background on these checks, see GitHub's guides to
[verifying release integrity][verify-release-integrity] and
[artifact attestations][artifact-attestations].

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release operation.

## Credits

AWS action data comes from
[@cloud-copilot/iam-data](https://github.com/cloud-copilot/iam-data), pinned in
package metadata and bundled at build time.

<!-- markdownlint-disable MD013 -->
[artifact-attestations]: https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
[dependabot-alerts]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts#limitations
[immutable-releases]: https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
[verify-release-integrity]: https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity
<!-- markdownlint-enable MD013 -->
