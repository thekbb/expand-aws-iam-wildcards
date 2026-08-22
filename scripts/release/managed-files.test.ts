import { describe, expect, it } from 'vitest';

import { type CommandResult, type ReleaseRuntime } from './command.js';
import {
  assertOnlyReleaseManagedFilesChanged,
  checkReleaseManagedFiles,
  RELEASE_MANAGED_FILES,
  unexpectedReleaseFiles,
} from './managed-files.js';

function runtime(result: CommandResult): ReleaseRuntime {
  return {
    env: {},
    promptEnter: () => undefined,
    run: () => result,
    sleep: () => undefined,
    stdinIsTTY: false,
    stdout: console,
  };
}

describe('release-managed files', () => {
  it('allows only release preparation files', () => {
    expect(RELEASE_MANAGED_FILES).toEqual([
      'CHANGELOG.md',
      'dist/index.js',
      'package-lock.json',
      'package.json',
    ]);
    expect(unexpectedReleaseFiles([
      ' M CHANGELOG.md',
      ' M dist/index.js',
      ' M package-lock.json',
      ' M package.json',
      '',
    ].join('\n'))).toEqual([]);
  });

  it('reports unexpected, untracked, duplicate, and renamed paths once', () => {
    expect(unexpectedReleaseFiles([
      ' M README.md',
      '?? notes.txt',
      ' M README.md',
      'R  docs/old.md -> docs/new.md',
      ' M package.json',
    ].join('\n'))).toEqual([
      'README.md',
      'docs/new.md',
      'notes.txt',
    ]);
  });

  it('throws a precise error for unmanaged release changes', () => {
    expect(() => assertOnlyReleaseManagedFilesChanged(' M README.md\n M src/main.ts\n')).toThrow(
      'Release preparation changed unmanaged file(s): README.md, src/main.ts',
    );
  });

  it('checks the current git status through the release runtime', () => {
    expect(() => checkReleaseManagedFiles(runtime({
      status: 0,
      stderr: '',
      stdout: ' M package.json\n M dist/index.js\n',
    }))).not.toThrow();

    expect(() => checkReleaseManagedFiles(runtime({
      status: 0,
      stderr: '',
      stdout: ' M README.md\n',
    }))).toThrow('Release preparation changed unmanaged file(s): README.md');
  });

  it('reports git status failures', () => {
    expect(() => checkReleaseManagedFiles(runtime({
      status: 128,
      stderr: 'not a git repository',
      stdout: '',
    }))).toThrow('git status --porcelain --untracked-files=all failed: not a git repository');
  });
});
