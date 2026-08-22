import { describe, expect, it } from 'vitest';

import { type CommandResult, type ReleaseRuntime } from './command.js';
import { createGitHubClient } from './github.js';

const releaseSha = 'babecafebabecafebabecafebabecafebabecafe';

function result(stdout: string): CommandResult {
  return { status: 0, stderr: '', stdout };
}

function signatureResponse(overrides: Record<string, unknown> = {}, oid = releaseSha): string {
  return JSON.stringify({
    data: {
      repository: {
        object: {
          oid,
          signature: {
            __typename: 'GpgSignature',
            isValid: true,
            keyId: 'B5690EEEBB952194',
            signer: { login: 'web-flow' },
            state: 'VALID',
            wasSignedByGitHub: true,
            ...overrides,
          },
        },
      },
    },
  });
}

function githubFor(response: string): ReturnType<typeof createGitHubClient> {
  const runtime: ReleaseRuntime = {
    env: {},
    promptEnter: () => undefined,
    run: () => result(response),
    sleep: () => undefined,
    stdinIsTTY: false,
    stdout: console,
  };
  return createGitHubClient(runtime);
}

describe('release commit signature policy', () => {
  it('accepts the exact commit signed by the approved GitHub web-flow key', () => {
    expect(() => githubFor(signatureResponse()).assertReleaseCommitSignature(releaseSha)).not.toThrow();
  });

  it('rejects a response for a different commit', () => {
    const wrongSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    expect(() => githubFor(signatureResponse({}, wrongSha)).assertReleaseCommitSignature(releaseSha)).toThrow(
      `GitHub returned the wrong release commit: ${wrongSha}, expected ${releaseSha}`,
    );
  });

  it('rejects an unsigned commit', () => {
    const response = JSON.stringify({ data: { repository: { object: { oid: releaseSha, signature: null } } } });
    expect(() => githubFor(response).assertReleaseCommitSignature(releaseSha)).toThrow(
      `release commit ${releaseSha} is unsigned`,
    );
  });

  it('rejects a signature GitHub did not verify', () => {
    expect(() => githubFor(signatureResponse({ isValid: false, state: 'EXPIRED_KEY' }))
      .assertReleaseCommitSignature(releaseSha)).toThrow(
      `release commit ${releaseSha} signature is not verified: EXPIRED_KEY`,
    );
  });

  it('rejects a valid signature from a different signer', () => {
    expect(() => githubFor(signatureResponse({ signer: { login: 'thekbb' } }))
      .assertReleaseCommitSignature(releaseSha)).toThrow(
      `release commit ${releaseSha} was not signed by GitHub web-flow`,
    );
  });

  it('rejects an unapproved GitHub signing key', () => {
    expect(() => githubFor(signatureResponse({ keyId: '0123456789ABCDEF' }))
      .assertReleaseCommitSignature(releaseSha)).toThrow(
      `release commit ${releaseSha} uses an unapproved GitHub signing key: 0123456789ABCDEF`,
    );
  });
});
