# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
