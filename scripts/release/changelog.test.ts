import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  finalizeChangelogContent,
  finalizeChangelogFile,
  runFinalizeChangelogCli,
} from './changelog.js';

const baseChangelog = `# Changelog

## [UNRELEASED]

### Fixed

- Fix release automation
- Keep publish checks strict

## [1.2.7] - 2026-07-03

### Fixed

- Previous release

[Unreleased]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.7...HEAD
[1.2.7]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.6...v1.2.7
`;

describe('finalizeChangelogContent', () => {
  it('moves unreleased notes under a dated release heading', () => {
    const result = finalizeChangelogContent(baseChangelog, {
      date: '2026-07-06',
      version: '1.3.0',
    });

    expect(result).toContain(`## [UNRELEASED]

## [1.3.0] - 2026-07-06

### Fixed

- Fix release automation
- Keep publish checks strict`);
  });

  it('updates the unreleased link and adds the release compare link', () => {
    const result = finalizeChangelogContent(baseChangelog, {
      date: '2026-07-06',
      version: '1.3.0',
    });

    expect(result).toContain(
      '[Unreleased]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.3.0...HEAD',
    );
    expect(result).toContain(
      '[1.3.0]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.7...v1.3.0',
    );
  });

  it('rejects a changelog without an unreleased heading', () => {
    expect(() =>
      finalizeChangelogContent(baseChangelog.replace('## [UNRELEASED]\n', ''), {
        date: '2026-07-06',
        version: '1.3.0',
      }),
    ).toThrow('CHANGELOG.md is missing an [UNRELEASED] heading');
  });

  it('rejects a changelog that already has the release heading', () => {
    expect(() =>
      finalizeChangelogContent(`${baseChangelog}\n## [1.3.0] - 2026-07-06\n`, {
        date: '2026-07-06',
        version: '1.3.0',
      }),
    ).toThrow('CHANGELOG.md already has a 1.3.0 heading');
  });

  it('rejects a changelog that already has the release link', () => {
    expect(() =>
      finalizeChangelogContent(`${baseChangelog}\n[1.3.0]: https://example.com\n`, {
        date: '2026-07-06',
        version: '1.3.0',
      }),
    ).toThrow('CHANGELOG.md already has a 1.3.0 link');
  });

  it('rejects a changelog without the expected unreleased compare link', () => {
    expect(() =>
      finalizeChangelogContent(
        baseChangelog.replace(
          '[Unreleased]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.7...HEAD',
          '[Unreleased]: https://example.com',
        ),
        {
          date: '2026-07-06',
          version: '1.3.0',
        },
      ),
    ).toThrow('CHANGELOG.md is missing the expected [Unreleased] compare link');
  });
});

describe('finalizeChangelogFile', () => {
  it('updates a changelog file in place', () => {
    const changelogPath = join(mkdtempSync(join(tmpdir(), 'release-changelog-')), 'CHANGELOG.md');
    writeFileSync(changelogPath, baseChangelog);

    finalizeChangelogFile(changelogPath, {
      date: '2026-07-06',
      version: '1.3.0',
    });

    expect(readFileSync(changelogPath, 'utf8')).toContain('## [1.3.0] - 2026-07-06');
  });
});

describe('runFinalizeChangelogCli', () => {
  it('finalizes CHANGELOG.md in the current working directory', () => {
    const previousCwd = process.cwd();
    const workspace = mkdtempSync(join(tmpdir(), 'release-changelog-cli-'));
    writeFileSync(join(workspace, 'CHANGELOG.md'), baseChangelog);

    process.chdir(workspace);
    try {
      const exitCode = runFinalizeChangelogCli({
        argv: ['node', 'changelog.ts', '1.3.0'],
        env: { RELEASE_DATE: '2026-07-06' },
        stderr: console,
      });

      expect(exitCode).toBe(0);
      expect(readFileSync('CHANGELOG.md', 'utf8')).toContain('## [1.3.0] - 2026-07-06');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('rejects a missing version argument', () => {
    const errors: string[] = [];

    const exitCode = runFinalizeChangelogCli({
      argv: ['node', 'changelog.ts'],
      env: {},
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: expected version input like 1.2.3']);
  });

  it('reports changelog finalization errors', () => {
    const errors: string[] = [];
    const previousCwd = process.cwd();

    process.chdir(mkdtempSync(join(tmpdir(), 'release-changelog-empty-')));
    try {
      const exitCode = runFinalizeChangelogCli({
        argv: ['node', 'changelog.ts', '1.3.0'],
        env: { RELEASE_DATE: '2026-07-06' },
        stderr: { error: (message: string) => errors.push(message) },
      });

      expect(exitCode).toBe(1);
      expect(errors).toEqual(['error: ENOENT: no such file or directory, open \'CHANGELOG.md\'']);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
