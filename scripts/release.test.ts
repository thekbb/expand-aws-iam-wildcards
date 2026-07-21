import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type CommandResult, type ReleaseRuntime } from './release/command.js';
import { runReleaseCli } from './release.js';
import { usage } from './release/cli.js';

function result(stdout = '', status = 0): CommandResult {
  return { status, stderr: '', stdout };
}

function createRuntime(responses: ReadonlyMap<string, CommandResult[]>): {
  calls: string[];
  output: string[];
  prompts: string[];
  runtime: Partial<ReleaseRuntime>;
} {
  const calls: string[] = [];
  const output: string[] = [];
  const prompts: string[] = [];

  return {
    calls,
    output,
    prompts,
    runtime: {
      env: { RELEASE_DATE: '2026-07-06' },
      promptEnter: (message) => {
        prompts.push(message);
        throw new Error('stop after prompt');
      },
      run: (command, args) => {
        const key = [command, ...args].join(' ');
        calls.push(key);
        const responseQueue = responses.get(key);
        const response = responseQueue?.shift();
        if (response === undefined) {
          throw new Error(`unexpected command: ${key}`);
        }

        return response;
      },
      sleep: () => undefined,
      stdinIsTTY: false,
      stdout: { log: (message: string) => output.push(message) },
    },
  };
}

const releaseSha = 'babecafebabecafebabecafebabecafebabecafe';

function continueResponses({
  changelog = '## [1.3.0] - 2026-07-06\n\n[1.3.0]: https://example.test/compare/v1.2.7...v1.3.0\n',
  draftReleaseExists = false,
  immutableReleaseAfterVerify = true,
  localTagCommit,
  lockfileVersion = '1.3.0',
  majorTagCommit = releaseSha,
  oldMajorTagCommit = releaseSha,
  packageVersion = '1.3.0',
  releaseAlreadyPublished = false,
  remoteTagCommit,
}: {
  changelog?: string;
  draftReleaseExists?: boolean;
  immutableReleaseAfterVerify?: boolean;
  localTagCommit?: string;
  lockfileVersion?: string;
  majorTagCommit?: string;
  oldMajorTagCommit?: string;
  packageVersion?: string;
  releaseAlreadyPublished?: boolean;
  remoteTagCommit?: string;
} = {}): Map<string, CommandResult[]> {
  const localTagExists = localTagCommit !== undefined;
  const remoteTagExists = remoteTagCommit !== undefined;
  const releaseViewsAfterVerify = immutableReleaseAfterVerify
    ? [result('{"isDraft":false,"isImmutable":true,"tagName":"v1.3.0","url":"https://example.test/release"}')]
    : Array.from({ length: 60 }, () =>
        result('{"isDraft":true,"isImmutable":false,"tagName":"v1.3.0","url":"https://example.test/release"}'),
      );

  return new Map([
    ['which git', [result()]],
    ['which gh', [result()]],
    ['which gpg', [result()]],
    ['gh auth status', [result()]],
    ['git branch --show-current', [result('main\n')]],
    ['git status --porcelain', [result('')]],
    ['git fetch origin main --tags', [result()]],
    ['git merge --ff-only origin/main', [result()]],
    ['git config --get user.signingkey', [result('ABC123\n')]],
    ['gpg --list-secret-keys ABC123', [result()]],
    [
      'gh pr list --state all --head release-candidate/v1.3.0 --base main --json state,mergeCommit',
      [result(`[{"state":"MERGED","mergeCommit":{"oid":"${releaseSha}"}}]`)],
    ],
    [`git merge-base --is-ancestor ${releaseSha} origin/main`, [result()]],
    [`git show ${releaseSha}:package.json`, [result(`{"version":"${packageVersion}"}`)]],
    [`git show ${releaseSha}:package-lock.json`, [result(`{"version":"${lockfileVersion}"}`)]],
    [`git show ${releaseSha}:CHANGELOG.md`, [result(changelog)]],
    [
      'git rev-parse -q --verify refs/tags/v1.3.0',
      localTagExists ? [result(), result()] : [result('', 1), result('', 1)],
    ],
    ...(localTagExists ? ([[`git rev-parse v1.3.0^{commit}`, [result(`${localTagCommit}\n`)]]] as const) : []),
    [
      'git ls-remote --exit-code origin refs/tags/v1.3.0',
      remoteTagExists ? [result(`${remoteTagCommit}\trefs/tags/v1.3.0\n`)] : [result('', 2)],
    ],
    ...(remoteTagExists
      ? ([[`git ls-remote --tags origin refs/tags/v1.3.0^{}`, [result(`${remoteTagCommit}\trefs/tags/v1.3.0^{}\n`)]]] as const)
      : ([[`git tag -s v1.3.0 ${releaseSha} -m v1.3.0`, [result()]], ['git push origin refs/tags/v1.3.0', [result()]]] as const)),
    [
      'gh release view v1.3.0 --json isDraft,isImmutable,tagName,url',
      [
        draftReleaseExists
          ? result('{"isDraft":true,"isImmutable":false,"tagName":"v1.3.0","url":"https://example.test/release"}')
          : releaseAlreadyPublished
          ? result('{"isDraft":false,"isImmutable":true,"tagName":"v1.3.0","url":"https://example.test/release"}')
          : result('', 1),
        releaseAlreadyPublished
          ? result('{"isDraft":false,"isImmutable":true,"tagName":"v1.3.0","url":"https://example.test/release"}')
          : result('{"isDraft":true,"isImmutable":false,"tagName":"v1.3.0","url":"https://example.test/release"}'),
        ...releaseViewsAfterVerify,
      ],
    ],
    ...(releaseAlreadyPublished || draftReleaseExists
      ? []
      : ([
          ['gh release create v1.3.0 --draft --verify-tag --generate-notes', [result()]],
          ['gh release view v1.3.0 --json isDraft,tagName,url', [result('{"isDraft":true,"tagName":"v1.3.0"}')]],
        ] as const)),
    ...(releaseAlreadyPublished
      ? []
      : ([
          [
            'gh run list --workflow verify-draft-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle --branch v1.3.0',
            [result('[]'), result('[{"databaseId":456,"displayTitle":"Verify v1.3.0"}]')],
          ],
          ['gh workflow run verify-draft-release.yml --ref v1.3.0 -f tag=v1.3.0', [result()]],
          ['gh run watch 456 --exit-status', [result()]],
        ] as const)),
    ['./verify-release.sh --tag v1.3.0', [result()]],
    [
      'git ls-remote --refs --tags origin refs/tags/v1',
      [result(oldMajorTagCommit === '' ? '' : `${oldMajorTagCommit}\trefs/tags/v1\n`)],
    ],
    ['git tag -s -f v1 v1.3.0^{commit} -m v1', [result()]],
    ...(oldMajorTagCommit === ''
      ? ([['git push origin refs/tags/v1', [result()]]] as const)
      : ([
          [
            `git push --force-with-lease=refs/tags/v1:${oldMajorTagCommit} origin refs/tags/v1`,
            [result()],
          ],
        ] as const)),
    [`git ls-remote --tags origin refs/tags/v1^{}`, [result(`${majorTagCommit}\trefs/tags/v1^{}\n`)]],
  ]);
}

describe('runReleaseCli', () => {
  it('prints help', () => {
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '--help'],
      stdout: { log: (message: string) => output.push(message) },
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([usage]);
    expect(errors).toEqual([]);
  });

  it('reports parse errors', () => {
    const errors: string[] = [];

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', 'v1.3.0'],
      stdout: console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(2);
    expect(errors).toEqual(['error: expected version input like 1.2.3']);
  });

  it('runs changelog finalization mode through the release CLI', () => {
    const errors: string[] = [];
    const previousCwd = process.cwd();
    const workspace = mkdtempSync(join(tmpdir(), 'release-cli-finalize-'));
    writeFileSync(
      join(workspace, 'CHANGELOG.md'),
      `# Changelog

## [UNRELEASED]

### Fixed

- Release fix

## [1.2.7] - 2026-07-03

[Unreleased]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.7...HEAD
[1.2.7]: https://github.com/thekbb/expand-aws-iam-wildcards/compare/v1.2.6...v1.2.7
`,
    );

    process.chdir(workspace);
    try {
      const exitCode = runReleaseCli({
        argv: ['node', 'release.ts', '1.3.0', '--finalize-changelog'],
        env: { RELEASE_DATE: '2026-07-06' },
        stdout: console,
        stderr: { error: (message: string) => errors.push(message) },
      });

      expect(exitCode).toBe(0);
      expect(errors).toEqual([]);
      expect(readFileSync('CHANGELOG.md', 'utf8')).toContain('## [1.3.0] - 2026-07-06');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('runs prepare release orchestration', () => {
    const errors: string[] = [];
    const { calls, output, runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result('babecafebabecafebabecafebabecafebabecafe\n')]],
        ['git rev-parse origin/main', [result('babecafebabecafebabecafebabecafebabecafe\n')]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('', 2)]],
        [
          'gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle',
          [result('[]'), result('[{"databaseId":123,"displayTitle":"Prepare v1.3.0"}]')],
        ],
        ['gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=true', [result()]],
        ['gh run watch 123 --exit-status', [result()]],
        [
          'gh pr list --state all --head release-candidate/v1.3.0 --base main --json url',
          [result('[{"url":"https://github.com/thekbb/expand-aws-iam-wildcards/pull/123"}]')],
        ],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).toContain('gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=true');
    expect(output.join('\n')).toContain('Release preparation PR is ready:');
  });

  it('prints the release preparation PR URL before the interactive merge prompt', () => {
    const errors: string[] = [];
    const prUrl = 'https://github.com/thekbb/expand-aws-iam-wildcards/pull/123';
    const { output, prompts, runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('', 2)]],
        [
          'gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle',
          [result('[]'), result('[{"databaseId":123,"displayTitle":"Prepare v1.3.0"}]')],
        ],
        ['gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=true', [result()]],
        ['gh run watch 123 --exit-status', [result()]],
        [
          'gh pr list --state all --head release-candidate/v1.3.0 --base main --json url',
          [result(`[{"url":"${prUrl}"}]`)],
        ],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime: { ...runtime, stdinIsTTY: true },
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: stop after prompt']);
    expect(output.join('\n')).toContain(prUrl);
    expect(prompts).toEqual(['Press Enter after the release preparation PR is merged, or Ctrl-C to resume later with --continue. ']);
  });

  it('runs prepare release orchestration with a manually finalized changelog', () => {
    const errors: string[] = [];
    const { calls, runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        [
          'git show HEAD:CHANGELOG.md',
          [result('## [1.3.0] - 2026-07-06\n\n[1.3.0]: https://example.test/compare/v1.2.7...v1.3.0\n')],
        ],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('', 2)]],
        [
          'gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle',
          [result('[]'), result('[{"databaseId":123,"displayTitle":"Prepare v1.3.0"}]')],
        ],
        ['gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=false', [result()]],
        ['gh run watch 123 --exit-status', [result()]],
        [
          'gh pr list --state all --head release-candidate/v1.3.0 --base main --json url',
          [result('[{"url":"https://github.com/thekbb/expand-aws-iam-wildcards/pull/123"}]')],
        ],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--no-finalize-changelog'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).toContain('gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=false');
  });

  it('rejects prepare mode when the working tree is dirty', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result(' M package.json\n')]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: working tree must be clean']);
  });

  it('rejects prepare mode when the remote release candidate branch exists', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('branch\n')]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: remote release candidate branch already exists: release-candidate/v1.3.0']);
  });

  it('rejects prepare mode when the local release tag already exists', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result()]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: local tag already exists: v1.3.0']);
  });

  it('rejects prepare mode when the remote release tag already exists', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result(`${releaseSha}\trefs/tags/v1.3.0\n`)]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: remote tag already exists: v1.3.0']);
  });

  it('rejects prepare mode when the newly dispatched workflow run cannot be found', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('', 2)]],
        [
          'gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle',
          [result('[]'), ...Array.from({ length: 30 }, () => result('[]'))],
        ],
        ['gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=true', [result()]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: could not find the newly dispatched Prepare v1.3.0 workflow run']);
  });

  it('rejects prepare mode when no release preparation PR is created', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git fetch origin main --tags', [result()]],
        ['git rev-parse HEAD', [result(`${releaseSha}\n`)]],
        ['git rev-parse origin/main', [result(`${releaseSha}\n`)]],
        ['git status --porcelain', [result('')]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['git show HEAD:CHANGELOG.md', [result('## [UNRELEASED]\n')]],
        ['git rev-parse -q --verify refs/tags/v1.3.0', [result('', 1)]],
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('', 2)]],
        ['git ls-remote --exit-code origin refs/heads/release-candidate/v1.3.0', [result('', 2)]],
        [
          'gh run list --workflow prepare-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle',
          [result('[]'), result('[{"databaseId":123,"displayTitle":"Prepare v1.3.0"}]')],
        ],
        ['gh workflow run prepare-release.yml -f version=1.3.0 -f finalize_changelog=true', [result()]],
        ['gh run watch 123 --exit-status', [result()]],
        ['gh pr list --state all --head release-candidate/v1.3.0 --base main --json url', [result('[]')]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      'error: Prepare Release completed, but no release preparation PR was found for release-candidate/v1.3.0',
    ]);
  });

  it('runs continue release orchestration through publication and major tag move', () => {
    const errors: string[] = [];
    const { calls, output, runtime } = createRuntime(continueResponses());

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).toContain('gh workflow run verify-draft-release.yml --ref v1.3.0 -f tag=v1.3.0');
    expect(calls).toContain(
      'git push --force-with-lease=refs/tags/v1:babecafebabecafebabecafebabecafebabecafe origin refs/tags/v1',
    );
    expect(output.join('\n')).toContain('Release complete:');
  });

  it('continues a release when the version tag and immutable release already exist', () => {
    const errors: string[] = [];
    const { calls, output, runtime } = createRuntime(
      continueResponses({
        releaseAlreadyPublished: true,
        remoteTagCommit: releaseSha,
      }),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).not.toContain(`git tag -s v1.3.0 ${releaseSha} -m v1.3.0`);
    expect(calls).not.toContain('gh workflow run verify-draft-release.yml --ref v1.3.0 -f tag=v1.3.0');
    expect(output.join('\n')).toContain('Release tag already exists on origin: v1.3.0');
    expect(output.join('\n')).toContain('Release v1.3.0 is already published and immutable');
  });

  it('pushes an existing matching local version tag when it is missing from origin', () => {
    const errors: string[] = [];
    const { calls, runtime } = createRuntime(continueResponses({ localTagCommit: releaseSha }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).not.toContain(`git tag -s v1.3.0 ${releaseSha} -m v1.3.0`);
    expect(calls).toContain('git push origin refs/tags/v1.3.0');
  });

  it('continues a release when the draft release already exists', () => {
    const errors: string[] = [];
    const { calls, output, runtime } = createRuntime(continueResponses({ draftReleaseExists: true }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).not.toContain('gh release create v1.3.0 --draft --verify-tag --generate-notes');
    expect(output.join('\n')).toContain('Draft release already exists for v1.3.0');
  });

  it('rejects an existing remote release tag that points at a different commit', () => {
    const errors: string[] = [];
    const wrongSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const { runtime } = createRuntime(continueResponses({ remoteTagCommit: wrongSha }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: remote tag v1.3.0 points to ${wrongSha}, expected ${releaseSha}`]);
  });

  it('pushes the major tag normally when no prior major tag exists', () => {
    const errors: string[] = [];
    const { calls, runtime } = createRuntime(continueResponses({ oldMajorTagCommit: '' }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(calls).toContain('git push origin refs/tags/v1');
  });

  it('rejects an existing local release tag that points at a different commit', () => {
    const errors: string[] = [];
    const wrongSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const { runtime } = createRuntime(continueResponses({ localTagCommit: wrongSha }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: local tag v1.3.0 points to ${wrongSha}, expected ${releaseSha}`]);
  });

  it('rejects release commit package metadata that does not match the requested version', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(continueResponses({ packageVersion: '1.2.9' }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: package.json at ${releaseSha} has version 1.2.9, expected 1.3.0`]);
  });

  it('rejects release commit lockfile metadata that does not match the requested version', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(continueResponses({ lockfileVersion: '1.2.9' }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: package-lock.json at ${releaseSha} has version 1.2.9, expected 1.3.0`]);
  });

  it('rejects release commit changelog content without the release compare link', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      continueResponses({ changelog: '## [1.3.0] - 2026-07-06\n\n[1.2.7]: https://example.test\n' }),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: CHANGELOG.md at ${releaseSha} is missing the 1.3.0 compare link`]);
  });

  it('rejects a publish workflow that does not make the release immutable', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(continueResponses({ immutableReleaseAfterVerify: false }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: release v1.3.0 was not published as immutable; inspect Publish Verified Release runs']);
  });

  it('rejects a moved major tag that does not resolve to the release commit', () => {
    const errors: string[] = [];
    const wrongSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const { runtime } = createRuntime(continueResponses({ majorTagCommit: wrongSha }));

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([`error: remote major tag v1 points to ${wrongSha}, expected ${releaseSha}`]);
  });

  it('rejects continue mode before the release preparation PR is merged', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git status --porcelain', [result('')]],
        ['git fetch origin main --tags', [result()]],
        ['git merge --ff-only origin/main', [result()]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        [
          'gh pr list --state all --head release-candidate/v1.3.0 --base main --json state,mergeCommit',
          [result('[{"state":"OPEN","mergeCommit":null}]')],
        ],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      'error: release-candidate/v1.3.0 pull request must be merged before continuing; current state: OPEN',
    ]);
  });

  it('rejects continue mode when the working tree is dirty', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git status --porcelain', [result(' M package.json\n')]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: working tree must be clean']);
  });

  it('rejects continue mode when the release preparation PR cannot be found', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git status --porcelain', [result('')]],
        ['git fetch origin main --tags', [result()]],
        ['git merge --ff-only origin/main', [result()]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        ['gh pr list --state all --head release-candidate/v1.3.0 --base main --json state,mergeCommit', [result('[]')]],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: could not find a release preparation pull request for release-candidate/v1.3.0']);
  });

  it('rejects continue mode when the release preparation PR has no valid merge commit', () => {
    const errors: string[] = [];
    const { runtime } = createRuntime(
      new Map([
        ['which git', [result()]],
        ['which gh', [result()]],
        ['which gpg', [result()]],
        ['gh auth status', [result()]],
        ['git branch --show-current', [result('main\n')]],
        ['git status --porcelain', [result('')]],
        ['git fetch origin main --tags', [result()]],
        ['git merge --ff-only origin/main', [result()]],
        ['git config --get user.signingkey', [result('ABC123\n')]],
        ['gpg --list-secret-keys ABC123', [result()]],
        [
          'gh pr list --state all --head release-candidate/v1.3.0 --base main --json state,mergeCommit',
          [result('[{"state":"MERGED","mergeCommit":{"oid":"not-a-sha"}}]')],
        ],
      ]),
    );

    const exitCode = runReleaseCli({
      argv: ['node', 'release.ts', '1.3.0', '--continue'],
      runtime,
      stdout: runtime.stdout ?? console,
      stderr: { error: (message: string) => errors.push(message) },
    });

    expect(exitCode).toBe(1);
    expect(errors).toEqual(['error: could not resolve release preparation PR merge commit']);
  });
});
