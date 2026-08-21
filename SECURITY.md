# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please
[email us](mailto:security@thekbb.net?subject=expand-aws-iam-wildcards%20security%20concern)
instead of opening a public issue.

We'll respond within 48 hours and work with you to understand and address the issue.

## Review Comment Ownership

Comment updates and deletion require both a recognized action comment shape
and an author matching the identity resolved from the configured token. This
supports GitHub Actions, GitHub App installation tokens, and personal access
tokens without trusting comments from other users or bots. Safely owned
comments from older releases are recognized by their generated body shape and
migrated to the current machine marker in place. Stale comments are not deleted
when pull-request diff analysis remains incomplete after fallback retrieval.

## Hosted End-to-End Test

The end-to-end workflow is manual-only and runs only from `main`. Its single
job receives only `contents: write` and `pull-requests: write` through the
short-lived `GITHUB_TOKEN`. It does not execute fork code or use a PAT. Every
run creates a uniquely named draft fixture pull request, then closes the pull
request and deletes its branch in an `always()` cleanup step.

## Release Verification

Release tags are signed with a GPG key. The armored public key is published at
[`keys/release-signing-key.asc`](keys/release-signing-key.asc).

Fingerprint:

```text
353A AFB2 1CE8 1D84 3634 AD3E DE52 EEA6 AF0D 8779
```

Users can import that key and verify release pins locally with `git verify-tag` and
`./verify-release.sh`.
