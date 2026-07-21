import { describe, expect, it } from 'vitest';

import { type CommandResult, type ReleaseRuntime } from './command.js';
import { createGitClient } from './git.js';

function result(stdout = '', status = 0): CommandResult {
  return { status, stderr: '', stdout };
}

function createRuntime(responses: ReadonlyMap<string, CommandResult[]>): {
  calls: string[];
  runtime: ReleaseRuntime;
} {
  const calls: string[] = [];

  return {
    calls,
    runtime: {
      env: {},
      promptEnter: () => undefined,
      run: (command, args) => {
        const key = [command, ...args].join(' ');
        calls.push(key);
        const response = responses.get(key)?.shift();
        if (response === undefined) {
          throw new Error(`unexpected command: ${key}`);
        }
        return response;
      },
      sleep: () => undefined,
      stdinIsTTY: false,
      stdout: console,
    },
  };
}

describe('createGitClient', () => {
  it('checks remote ref existence by git ls-remote status', () => {
    const { runtime } = createRuntime(
      new Map([
        ['git ls-remote --exit-code origin refs/tags/v1.3.0', [result('tag\n'), result('', 2), result('', 128)]],
      ]),
    );
    const git = createGitClient(runtime);

    expect(git.refExistsOnOrigin('refs/tags/v1.3.0')).toBe(true);
    expect(git.refExistsOnOrigin('refs/tags/v1.3.0')).toBe(false);
    expect(() => git.refExistsOnOrigin('refs/tags/v1.3.0')).toThrow(
      'failed to check remote ref: refs/tags/v1.3.0',
    );
  });

  it('rejects a missing signing key before checking gpg', () => {
    const { calls, runtime } = createRuntime(new Map([['git config --get user.signingkey', [result('')]]]));

    expect(() => createGitClient(runtime).assertSigningKeyAvailable()).toThrow('git user.signingkey is not configured');
    expect(calls).toEqual(['git config --get user.signingkey']);
  });

  it('reports release commits that are not reachable from origin main', () => {
    const sha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const { runtime } = createRuntime(new Map([[`git merge-base --is-ancestor ${sha} origin/main`, [result('', 1)]]]));

    expect(() => createGitClient(runtime).assertReleaseCommitOnOriginMain(sha)).toThrow(
      `release commit ${sha} is not reachable from origin/main`,
    );
  });

  it('parses the first SHA from remote refs', () => {
    const { runtime } = createRuntime(
      new Map([
        [
          'git ls-remote --refs --tags origin refs/tags/v1',
          [result('babecafebabecafebabecafebabecafebabecafe\trefs/tags/v1\n')],
        ],
      ]),
    );

    expect(createGitClient(runtime).remoteRefSha('refs/tags/v1')).toBe(
      'babecafebabecafebabecafebabecafebabecafe',
    );
  });
});
