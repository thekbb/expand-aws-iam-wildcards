# Expand IAM Wildcards Action

[![CI](https://github.com/thekbb/expand-iam-wildcards/actions/workflows/ci.yml/badge.svg)](https://github.com/thekbb/expand-iam-wildcards/actions/workflows/ci.yml)
[![GitHub tag](https://img.shields.io/github/v/tag/thekbb/expand-iam-wildcards)](https://github.com/thekbb/expand-iam-wildcards/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action that automatically detects AWS IAM wildcard actions in pull requests and posts inline comments showing
the actions each wildcard expands to.

## Why?

IAM policies with wildcards like `s3:Get*` or `ec2:Describe*` can grant far more permissions than
intended. This action helps reviewers understand the full scope of permissions being granted by
expanding wildcards into their complete list of matching actions.

## Example

When a PR introduces a line like:

```hcl
"s3:Put*",
```

The action will post an inline comment showing all 38+ S3 Put actions that this wildcard matches:

>`s3:Put*` expands to 38 actions:
>
><details>
><summary>Click to expand</summary>
>
>```json
>1  "s3:PutAccelerateConfiguration"
>2  "s3:PutAccessGrantsInstanceResourcePolicy"
>3  "s3:PutAccessPointConfigurationForObjectLambda"
>4  "s3:PutAccessPointPolicy"
>5  "s3:PutAccessPointPolicyForObjectLambda"
>6  "s3:PutAccessPointPublicAccessBlock"
>7  "s3:PutAccountPublicAccessBlock"
>8  "s3:PutAnalyticsConfiguration"
>9  "s3:PutBucketAbac"
>10 "s3:PutBucketAcl"
>11 "s3:PutBucketCORS"
>12 "s3:PutBucketLogging"
>13 "s3:PutBucketNotification"
>14 "s3:PutBucketObjectLockConfiguration"
>15 "s3:PutBucketOwnershipControls"
>16 "s3:PutBucketPolicy"
>17 "s3:PutBucketPublicAccessBlock"
>18 "s3:PutBucketRequestPayment"
>19 "s3:PutBucketTagging"
>20 "s3:PutBucketVersioning"
>21 "s3:PutBucketWebsite"
>22 "s3:PutEncryptionConfiguration"
>23 "s3:PutIntelligentTieringConfiguration"
>24 "s3:PutInventoryConfiguration"
>25 "s3:PutJobTagging"
>26 "s3:PutLifecycleConfiguration"
>27 "s3:PutMetricsConfiguration"
>28 "s3:PutMultiRegionAccessPointPolicy"
>29 "s3:PutObject"
>30 "s3:PutObjectAcl"
>31 "s3:PutObjectLegalHold"
>32 "s3:PutObjectRetention"
>33 "s3:PutObjectTagging"
>34 "s3:PutObjectVersionAcl"
>35 "s3:PutObjectVersionTagging"
>36 "s3:PutReplicationConfiguration"
>37 "s3:PutStorageLensConfiguration"
>38 "s3:PutStorageLensConfigurationTagging"
>```

</details>

### Consecutive Lines Are Grouped

If wildcards appear on consecutive lines (common in IAM policies), they're combined into a single comment
with a sorted, deduplicated list:

```hcl
Action = [
  "s3:Get*",
  "s3:Put*",
  "s3:Delete*",
]
```

Results in one comment:

> 3 wildcard patterns expand to 150 action(s):
>
> ```hcl
> s3:Get*
> s3:Put*
> s3:Delete*
>```
> <details>
> <summary>Click to expand</summary>
>
> ```json
> 1  "s3:Delete"
> 2  "s3:GetAccelerateConfiguration"
> 3  "s3:GetAccessGrant"
> 4  "s3:GetAccessGrantsInstance"
> 5  "s3:GetAccessGrantsInstanceForPrefix"
> 6  "s3:GetAccessGrantsInstanceResourcePolicy"
> 7  "s3:GetAccessGrantsLocation"
> 8  "s3:GetAccessPoint"
> 9  "s3:GetAccessPointConfigurationForObjectLambda"
> 10 "s3:GetAccessPointForObjectLambda"
> 11 "s3:GetAccessPointPolicy"
> 12 "s3:GetAccessPointPolicyForObjectLambda"
> 13 "s3:GetAccessPointPolicyStatus"
> 14 "s3:GetAccessPointPolicyStatusForObjectLambda"
> 15 "s3:GetAccountPublicAccessBlock"
> 16 "s3:GetAnalyticsConfiguration"
> 17 "s3:GetBucketAbac"
> 18 "s3:GetBucketAcl"
> 19 "s3:GetBucketCORS"
> 20 "s3:GetBucketLocation"
> 21 "s3:GetBucketLogging"
> 22 "s3:GetBucketMetadataTableConfiguration"
> 23 "s3:GetBucketNotification"
> 24 "s3:GetBucketObjectLockConfiguration"
> 25 "s3:GetBucketOwnershipControls"
> 26 "s3:GetBucketPolicy"
> 27 "s3:GetBucketPolicyStatus"
> 28 "s3:GetBucketPublicAccessBlock"
> 29 "s3:GetBucketRequestPayment"
> 30 "s3:GetBucketTagging"
> 31 "s3:GetBucketVersioning"
> 32 "s3:GetBucketWebsite"
> 33 "s3:GetDataAccess"
> 34 "s3:GetEncryptionConfiguration"
> 35 "s3:GetIntelligentTieringConfiguration"
> 36 "s3:GetInventoryConfiguration"
> 37 "s3:GetJobTagging"
> 38 "s3:GetLifecycleConfiguration"
> 39 "s3:GetMetricsConfiguration"
> 40 "s3:GetMultiRegionAccessPoint"
> 41 "s3:GetMultiRegionAccessPointPolicy"
> 42 "s3:GetMultiRegionAccessPointPolicyStatus"
> 43 "s3:GetMultiRegionAccessPointRoutes"
> 44 "s3:GetObject"
> 45 "s3:GetObjectAcl"
> 46 "s3:GetObjectAttributes"
> 47 "s3:GetObjectLegalHold"
> 48 "s3:GetObjectRetention"
> 49 "s3:GetObjectTagging"
> 50 "s3:GetObjectTorrent"
> 51 "s3:GetObjectVersion"
> 52 "s3:GetObjectVersionAcl"
> 53 "s3:GetObjectVersionAttributes"
> 54 "s3:GetObjectVersionForReplication"
> 55 "s3:GetObjectVersionTagging"
> 56 "s3:GetObjectVersionTorrent"
> 57 "s3:GetReplicationConfiguration"
> 58 "s3:GetStorageLensConfiguration"
> 59 "s3:GetStorageLensConfigurationTagging"
> 60 "s3:GetStorageLensDashboard"
> 61 "s3:GetStorageLensGroup"
> 62 "s3:PutAccelerateConfiguration"
> 63 "s3:PutAccessGrantsInstanceResourcePolicy"
> 64 "s3:PutAccessPointConfigurationForObjectLambda"
> 65 "s3:PutAccessPointPolicy"
> 66 "s3:PutAccessPointPolicyForObjectLambda"
> 67 "s3:PutAccessPointPublicAccessBlock"
> 68 "s3:PutAccountPublicAccessBlock"
> 69 "s3:PutAnalyticsConfiguration"
> 70 "s3:PutBucketAbac"
> 71 "s3:PutBucketAcl"
> 72 "s3:PutBucketCORS"
> 73 "s3:PutBucketLogging"
> 74 "s3:PutBucketNotification"
> 75 "s3:PutBucketObjectLockConfiguration"
> 76 "s3:PutBucketOwnershipControls"
> 77 "s3:PutBucketPolicy"
> 78 "s3:PutBucketPublicAccessBlock"
> 79 "s3:PutBucketRequestPayment"
> 80 "s3:PutBucketTagging"
> 81 "s3:PutBucketVersioning"
> 82 "s3:PutBucketWebsite"
> 83 "s3:PutEncryptionConfiguration"
> 84 "s3:PutIntelligentTieringConfiguration"
> 85 "s3:PutInventoryConfiguration"
> 86 "s3:PutJobTagging"
> 87 "s3:PutLifecycleConfiguration"
> 88 "s3:PutMetricsConfiguration"
> 89 "s3:PutMultiRegionAccessPointPolicy"
> 90 "s3:PutObject"
> 91 "s3:PutObjectAcl"
> 92 "s3:PutObjectLegalHold"
> 93 "s3:PutObjectRetention"
> 94 "s3:PutObjectTagging"
> 95 "s3:PutObjectVersionAcl"
> 96 "s3:PutObjectVersionTagging"
> 97 "s3:PutReplicationConfiguration"
> 98 "s3:PutStorageLensConfiguration"
> 99 "s3:PutStorageLensConfigurationTagging"
> ```
</details>

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
        uses: thekbb/expand-iam-wildcards@v1
```

### Terraform Only

To scan only Terraform files:

```yaml
jobs:
  expand-wildcards:
    runs-on: ubuntu-latest
    steps:
      - name: Expand IAM Wildcards
        uses: thekbb/expand-iam-wildcards@v1
        with:
          file-patterns: '**/*.tf'
```

## Inputs

| Input | Description | Required | Default |
|------|-------------|----------|---------|
| `github-token` | GitHub token for API access | No | `${{ github.token }}` |
| `file-patterns` | Glob patterns for files to scan (comma-separated) | No | `**/*.json,**/*.yaml,**/*.yml,**/*.tf,**/*.ts,**/*.js` |
| `collapse-threshold` | Number of expanded actions before collapsing into `<details>` | No | `5` |

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

## License

MIT
