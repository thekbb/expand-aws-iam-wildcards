# Expand IAM Wildcards Action

[![CI](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml/badge.svg)](https://github.com/thekbb/expand-aws-iam-wildcards/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/v/tag/thekbb/expand-aws-iam-wildcards)](https://github.com/thekbb/expand-aws-iam-wildcards/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![codecov](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards/branch/main/graph/badge.svg)](https://codecov.io/gh/thekbb/expand-aws-iam-wildcards)

A GitHub Action that automatically detects AWS IAM wildcard actions in pull requests and posts inline comments showing
the actions each wildcard expands to.

## Why?

IAM policies with wildcards like `s3:Get*` or `ec2:Describe*` can grant far more permissions than
intended. This action helps reviewers understand the full scope of permissions being granted by
expanding wildcards into their complete list of matching actions, with handy links to the docs.

TL;DR: Make it easier for reviewers to quickly determine what a `*` in an AWS action does.

## Example

When a PR introduces a line like:

```hcl
"s3:Get*Tagging",
```

The action will post an inline comment showing the S3 actions that match:
Each action is a link to the AWS documentation for that action.

> **IAM Wildcard Expansion**
>
> `s3:Get*Tagging` expands to 5 action(s):
>
> 1. [`s3:getbuckettagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 2. [`s3:getjobtagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 3. [`s3:getobjecttagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 4. [`s3:getobjectversiontagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 5. [`s3:getstoragelenstagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)

### Consecutive Lines Are Grouped

If wildcards appear on consecutive lines (common in IAM policies), they're combined into a single comment
with a sorted, deduplicated list:

```hcl
Action = [
  "s3:Get*Tagging",
  "s3:Put*Tagging",
]
```

Results in one comment:

> **IAM Wildcard Expansion**
>
> 2 wildcard patterns expand to 10 action(s):
>
> **Patterns:**
>
> - `s3:Get*Tagging`
> - `s3:Put*Tagging`
>
> 1. [`s3:getbuckettagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 2. [`s3:getjobtagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 3. [`s3:getobjecttagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 4. [`s3:getobjectversiontagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 5. [`s3:getstoragelenstagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 6. [`s3:putbuckettagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 7. [`s3:putjobtagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 8. [`s3:putobjecttagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 9. [`s3:putobjectversiontagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)
> 10. [`s3:putstoragelenstagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html)

## Usage

Add this workflow to your repository at:

```shell
.github/workflows/iam-wildcards.yml
```

```yaml
name: Expand IAM Wildcards

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  expand-wildcards:
    runs-on: ubuntu-latest
    steps:
      - name: Expand IAM Wildcards
        uses: thekbb/expand-aws-iam-wildcards@v1
```

### Terraform Only

To scan only Terraform files:

```yaml
jobs:
  expand-wildcards:
    runs-on: ubuntu-latest
    steps:
      - name: Expand IAM Wildcards
        uses: thekbb/expand-aws-iam-wildcards@v1
        with:
          file-patterns: '**/*.tf'
```

## Inputs

| Input | Description | Required | Default |
| ----- | ----------- | -------- | ------- |
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |
| `file-patterns` | Glob patterns for files to scan (comma-separated) | No | See below |
| `collapse-threshold` | Number of expanded actions before collapsing | No | `5` |

Default file patterns: `**/*.json,**/*.yaml,**/*.yml,**/*.tf,**/*.ts,**/*.js`

## Supported File Types

The action scans the following file types by default:

- JSON files (`.json`) - IAM policies, CloudFormation templates
- YAML files (`.yaml`, `.yml`) - CloudFormation, SAM templates
- Terraform files (`.tf`)
- TypeScript/JavaScript files (`.ts`, `.js`) - CDK code

## How It Works

1. When a PR is opened or updated, the action fetches the diff
2. It scans added/modified lines for patterns matching IAM actions with wildcards (e.g., `service:Action*`)
3. Uses [@cloud-copilot/iam-expand](https://github.com/cloud-copilot/iam-expand) to expand wildcards into specific actions
4. Posts inline review comments on the relevant lines

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

The built action is output to the `dist/` directory, which should be committed.

### Type Check

```bash
npm run typecheck
```

## Credits

This action uses [@cloud-copilot/iam-expand](https://github.com/cloud-copilot/iam-expand) for expanding IAM wildcard actions.
