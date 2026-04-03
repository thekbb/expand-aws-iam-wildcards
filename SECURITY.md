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

## Release Verification

Release tags are signed with a GPG key. The armored public key is published at
[`keys/release-signing-key.asc`](keys/release-signing-key.asc).

Fingerprint:

```text
353A AFB2 1CE8 1D84 3634 AD3E DE52 EEA6 AF0D 8779
```

Users can import that key and verify release pins locally with `git verify-tag` and
`./verify-release.sh`.
