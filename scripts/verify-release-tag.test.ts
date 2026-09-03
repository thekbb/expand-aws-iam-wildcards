import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const verifier = join(repositoryRoot, 'scripts/verify-release-tag.sh');
const approvedFingerprint = '353AAFB21CE81D843634AD3EDE52EEA6AF0D8779';

function verifyTag(options: {
  readonly fingerprint?: string;
  readonly objectType?: string;
  readonly status?: number;
  readonly tag?: string;
} = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'release-tag-verifier-'));
  try {
    const fakeGit = join(fixture, 'git');
    writeFileSync(fakeGit, `#!/usr/bin/env bash
if [[ "$*" == *"cat-file -t"* ]]; then
  printf '%s\\n' "\${OBJECT_TYPE:-tag}"
  exit 0
fi
printf '[GNUPG:] VALIDSIG SUBKEY 2026-08-22 0 0 4 0 1 10 00 %s\\n' "\${SIGNER_FINGERPRINT}" >&2
exit "\${VERIFY_STATUS:-0}"
`);
    chmodSync(fakeGit, 0o755);

    return spawnSync('bash', [verifier, fixture, options.tag ?? 'v2.0.0'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        OBJECT_TYPE: options.objectType ?? 'tag',
        PATH: `${fixture}:${process.env.PATH ?? ''}`,
        SIGNER_FINGERPRINT: options.fingerprint ?? approvedFingerprint,
        VERIFY_STATUS: String(options.status ?? 0),
      },
    });
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
}

describe('release tag verifier', () => {
  it('accepts an annotated version tag signed by the approved release key', () => {
    const result = verifyTag();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`release signing key ${approvedFingerprint}`);
  });

  it('accepts an annotated major tag signed by the approved release key', () => {
    const majorResult = verifyTag({ tag: 'v2' });

    expect(majorResult.status).toBe(0);
  });

  it('rejects a tag signed by another key', () => {
    const result = verifyTag({ fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('was not signed by the approved release key');
  });

  it('rejects lightweight, invalidly signed, and malformed tags', () => {
    expect(verifyTag({ objectType: 'commit' }).status).toBe(1);
    expect(verifyTag({ status: 1 }).status).toBe(1);
    expect(verifyTag({ tag: 'release-2' }).status).toBe(2);
  });
});
