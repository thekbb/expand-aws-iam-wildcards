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
  runtime: Partial<ReleaseRuntime>;
} {
  const calls: string[] = [];
  const output: string[] = [];

  return {
    calls,
    output,
    runtime: {
      env: { RELEASE_DATE: '2026-07-06' },
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
  immutableReleaseAfterVerify = true,
  localTagCommit,
  majorTagCommit = releaseSha,
  packageVersion = '1.3.0',
  remoteTagCommit,
}: {
  changelog?: string;
  immutableReleaseAfterVerify?: boolean;
  localTagCommit?: string;
  majorTagCommit?: string;
  packageVersion?: string;
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
    [`git show ${releaseSha}:package-lock.json`, [result('{"version":"1.3.0"}')]],
    [`git show ${releaseSha}:CHANGELOG.md`, [result(changelog)]],
    [
      'git rev-parse -q --verify refs/tags/v1.3.0',
      localTagExists ? [result()] : [result('', 1), result('', 1)],
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
        result('', 1),
        result('{"isDraft":true,"isImmutable":false,"tagName":"v1.3.0","url":"https://example.test/release"}'),
        ...releaseViewsAfterVerify,
      ],
    ],
    ['gh release create v1.3.0 --draft --verify-tag --generate-notes', [result()]],
    ['gh release view v1.3.0 --json isDraft,tagName,url', [result('{"isDraft":true,"tagName":"v1.3.0"}')]],
    [
      'gh run list --workflow verify-draft-release.yml --event workflow_dispatch --limit 50 --json databaseId,displayTitle --branch v1.3.0',
      [result('[]'), result('[{"databaseId":456,"displayTitle":"Verify v1.3.0"}]')],
    ],
    ['gh workflow run verify-draft-release.yml --ref v1.3.0 -f tag=v1.3.0', [result()]],
    ['gh run watch 456 --exit-status', [result()]],
    ['./verify-release.sh --tag v1.3.0', [result()]],
    ['git ls-remote --refs --tags origin refs/tags/v1', [result('babecafebabecafebabecafebabecafebabecafe\trefs/tags/v1\n')]],
    ['git tag -s -f v1 v1.3.0^{commit} -m v1', [result()]],
    [
      'git push --force-with-lease=refs/tags/v1:babecafebabecafebabecafebabecafebabecafe origin refs/tags/v1',
      [result()],
    ],
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
});
