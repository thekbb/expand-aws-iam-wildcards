import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const verifier = join(repositoryRoot, 'scripts/verify-github-commit.sh');
const sha = 'babecafebabecafebabecafebabecafebabecafe';

function verify(record: string, repository = 'thekbb/expand-aws-iam-wildcards', commit = sha) {
  const fixture = mkdtempSync(join(tmpdir(), 'github-commit-verifier-'));
  try {
    const fakeGh = join(fixture, 'gh');
    writeFileSync(fakeGh, [
      '#!/usr/bin/env bash',
      '[[ "$1" == api && "$2" == --hostname && "$3" == github.com && "$4" == graphql ]] || exit 64',
      'printf \'%s\\n\' "$SIGNATURE_RECORD"',
      '',
    ].join('\n'));
    chmodSync(fakeGh, 0o755);

    return spawnSync('bash', [verifier, repository, commit], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fixture}:${process.env.PATH ?? ''}`,
        SIGNATURE_RECORD: record,
      },
    });
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

const validRecord = [
  sha,
  'GpgSignature',
  'true',
  'VALID',
  'true',
  'web-flow',
  'B5690EEEBB952194',
].join('\t');

describe('GitHub release commit verifier', () => {
  it('accepts the exact commit signed by the approved GitHub web-flow key', () => {
    const result = verify(validRecord);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Verified GitHub web-flow signature for ${sha}.`);
  });

  it.each([
    ['wrong SHA', validRecord.replace(sha, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')],
    ['invalid signature', validRecord.replace('\ttrue\tVALID\t', '\tfalse\tEXPIRED_KEY\t')],
    ['wrong signer', validRecord.replace('\tweb-flow\t', '\tthekbb\t')],
    ['unapproved key', validRecord.replace('B5690EEEBB952194', '0123456789ABCDEF')],
  ])('rejects %s', (_label, record) => {
    const result = verify(record);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Commit ${sha} does not have the approved GitHub web-flow signature.`);
  });

  it('rejects malformed repository and commit arguments before calling GitHub', () => {
    expect(verify(validRecord, 'not-a-repository').status).toBe(2);
    expect(verify(validRecord, 'thekbb/expand-aws-iam-wildcards', 'short').status).toBe(2);
  });
});
