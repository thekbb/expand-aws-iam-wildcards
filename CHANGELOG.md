# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.9]

### Changed

- Refactor per-patch parsing in diff processing
- Update all dependencies
- Group all NPM dependabot updates into one pull request. Having development dependencies in a separate PR had little
  value and lead to merge conflicts in `package-lock.json`

## [1.1.8] - 2026-1-31

### Fixed

- Dependency updates, mainly to update [undici](https://www.npmjs.com/package/undici) due to [CVE-2026-22036](https://nvd.nist.gov/vuln/detail/CVE-2026-22036)
  TIL: Undici means eleven in Italian, the package name is a _Stranger Things_ reference.

## [1.1.7] - 2026-1-30

### Changed

- Change IAM action casing to use the action name from the data object rather than the object key
  `dynamodb:DescribeBackup`, rather than `dynamodb:describebackup`

## [1.1.6] - 2026-01-28

### Changed

- Update IAM action data with new services/actions from AWS
- Track @cloud-copilot/iam-data directly to allow dependabot to update it
- Explicitly update @cloud-copilot/iam-data in the update-iam-data workflow
- Update contributor documentation for markdown linting. Thank you, @russellsanborn
- Dependency updates

## [1.1.5] - 2026-01-10

### Changed

- Update Node to 20.19.0
- Improve logging for the scheduled IAM data update workflow
- Replace @types/minimatch with minimatch
- Dependency updates

### Fixed

- Markdown linting issues
- README cleanup and screenshot updates

## [1.1.4] - 2025-12-14

### Added

- Markdown linting with CI enforcement
- Add code of conduct
- Add test for the unknown service edge case

### Changed

- Refactor action logic out of index.ts into action.ts
- Exclude `types.ts` from coverage reporting
- Add code coverage badge to impress everyone

## [1.1.3] - 2025-12-13

### Changed

- Update GitHub Action text and description length for Marketplace
- Change file-patterns handling to use minimatch globs, trim and ignore empty entries, and skip scanning with a clear
  message when no files match

## [1.1.2] - 2025-12-13

### Added

- Add Issue templates for bugs and feature requests

### Changed

- Expanded actions list is now ordered
- Remove security issue type from issue templates (`SECURITY.md` directs those issues be sent via email)

## [1.1.1] - 2025-12-13

### Added

- Add CONTRIBUTING guide
- Add security policy
- Add Dependabot for npm and GitHub Actions
- Add CI for tests and linting

### Changed

- Link expanded actions to AWS documentation
- README badges and formatting updates

## [1.1.0] - 2025-12-12

### Added

- Add collapse-threshold input to configure when expanded actions render in a collapsible details block versus inline list

## [1.0.1] - 2025-12-12

### Changed

- Make github-token optional with a default
- Add Terraform only example

## [1.0.0] - 2025-12-12

### Added

- Add initial release

<!-- markdownlint-disable-next-line MD053 -->
[Unreleased]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.8...HEAD
[1.1.8]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.7...v1.1.8
[1.1.7]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.6...v1.1.7
[1.1.6]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/thekbb/expand-aws-iam-wildcards/releases/tag/v1.0.0
