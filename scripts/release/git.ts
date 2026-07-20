import { type ReleaseRuntime, requireCommand, runChecked, runText } from './command.js';

export interface GitClient {
  assertReleaseCommitOnOriginMain: (releaseSha: string) => void;
  assertSigningKeyAvailable: () => void;
  createOrReplaceSignedTag: (tag: string, target: string) => void;
  createSignedTag: (tag: string, target: string) => void;
  currentBranch: () => string;
  fetchMainAndTags: () => void;
  forcePushTagWithLease: (tag: string, oldSha: string) => void;
  hasLocalTag: (tag: string) => boolean;
  headSha: () => string;
  localTagCommit: (tag: string) => string;
  mergeFfOnlyOriginMain: () => void;
  originMainSha: () => string;
  pushTag: (tag: string) => void;
  refExistsOnOrigin: (ref: string) => boolean;
  remoteAnnotatedTagCommit: (tag: string) => string;
  remoteRefSha: (ref: string) => string;
  requireAvailable: () => void;
  showFile: (revisionPath: string) => string;
  statusPorcelain: () => string;
}

function firstSha(output: string): string {
  return output.trim().split(/\s+/)[0] ?? '';
}

export function createGitClient(runtime: ReleaseRuntime): GitClient {
  return {
    assertReleaseCommitOnOriginMain: (releaseSha) => {
      const result = runtime.run('git', ['merge-base', '--is-ancestor', releaseSha, 'origin/main']);
      if (result.status !== 0) {
        throw new Error(`release commit ${releaseSha} is not reachable from origin/main`);
      }
    },
    assertSigningKeyAvailable: () => {
      const signingKey = runtime.run('git', ['config', '--get', 'user.signingkey']).stdout.trim();
      if (signingKey === '') {
        throw new Error('git user.signingkey is not configured');
      }

      runChecked(runtime, 'gpg', ['--list-secret-keys', signingKey]);
    },
    createOrReplaceSignedTag: (tag, target) => runChecked(runtime, 'git', ['tag', '-s', '-f', tag, target, '-m', tag]),
    createSignedTag: (tag, target) => runChecked(runtime, 'git', ['tag', '-s', tag, target, '-m', tag]),
    currentBranch: () => runText(runtime, 'git', ['branch', '--show-current']),
    fetchMainAndTags: () => runChecked(runtime, 'git', ['fetch', 'origin', 'main', '--tags']),
    forcePushTagWithLease: (tag, oldSha) =>
      runChecked(runtime, 'git', ['push', `--force-with-lease=refs/tags/${tag}:${oldSha}`, 'origin', `refs/tags/${tag}`]),
    hasLocalTag: (tag) => runtime.run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0,
    headSha: () => runText(runtime, 'git', ['rev-parse', 'HEAD']),
    localTagCommit: (tag) => runText(runtime, 'git', ['rev-parse', `${tag}^{commit}`]),
    mergeFfOnlyOriginMain: () => runChecked(runtime, 'git', ['merge', '--ff-only', 'origin/main']),
    originMainSha: () => runText(runtime, 'git', ['rev-parse', 'origin/main']),
    pushTag: (tag) => runChecked(runtime, 'git', ['push', 'origin', `refs/tags/${tag}`]),
    refExistsOnOrigin: (ref) => {
      const result = runtime.run('git', ['ls-remote', '--exit-code', 'origin', ref]);
      if (result.status === 0) {
        return true;
      }

      if (result.status === 2) {
        return false;
      }

      throw new Error(`failed to check remote ref: ${ref}`);
    },
    remoteAnnotatedTagCommit: (tag) => firstSha(runText(runtime, 'git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}^{}`])),
    remoteRefSha: (ref) => firstSha(runText(runtime, 'git', ['ls-remote', '--refs', '--tags', 'origin', ref])),
    requireAvailable: () => {
      requireCommand(runtime, 'git');
      requireCommand(runtime, 'gpg');
    },
    showFile: (revisionPath) => runText(runtime, 'git', ['show', revisionPath]),
    statusPorcelain: () => runText(runtime, 'git', ['status', '--porcelain']),
  };
}
