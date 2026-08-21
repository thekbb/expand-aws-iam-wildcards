import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type CommandRunner } from './release/command.js';
import { IAM_DATA_PACKAGE } from './release/iam-data.js';
import { runSelectIamDataCli } from './select-iam-data.js';

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'iam-data-cli-test-'));
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      devDependencies: { [IAM_DATA_PACKAGE]: '0.21.2' },
    }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
      packages: {
        '': { devDependencies: { [IAM_DATA_PACKAGE]: '0.21.2' } },
        [`node_modules/${IAM_DATA_PACKAGE}`]: { version: '0.21.2' },
      },
    }));
    return useFixture(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function updateRunner(directory: string, version: string): CommandRunner {
  return () => {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      devDependencies: { [IAM_DATA_PACKAGE]: version },
    }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
      packages: {
        '': { devDependencies: { [IAM_DATA_PACKAGE]: version } },
        [`node_modules/${IAM_DATA_PACKAGE}`]: { version },
      },
    }));
    return { status: 0, stderr: '', stdout: '' };
  };
}

describe('runSelectIamDataCli', () => {
  it('reports the selected version', () => {
    withFixture((repositoryRoot) => {
      const output: string[] = [];
      const errors: string[] = [];

      expect(runSelectIamDataCli({
        args: ['0.21.3'],
        repositoryRoot,
        run: updateRunner(repositoryRoot, '0.21.3'),
        stdout: { log: (message) => output.push(message) },
        stderr: { error: (message) => errors.push(message) },
      })).toBe(0);
      expect(output).toEqual([
        'Selected @cloud-copilot/iam-data 0.21.3 (previously 0.21.2).',
      ]);
      expect(errors).toEqual([]);
    });
  });

  it('reports an unchanged version', () => {
    withFixture((repositoryRoot) => {
      const output: string[] = [];

      expect(runSelectIamDataCli({
        args: ['0.21.2'],
        repositoryRoot,
        run: updateRunner(repositoryRoot, '0.21.2'),
        stdout: { log: (message) => output.push(message) },
        stderr: console,
      })).toBe(0);
      expect(output).toEqual([
        'Kept @cloud-copilot/iam-data 0.21.2 (previously 0.21.2).',
      ]);
    });
  });

  it('reports usage and selection errors without running npm', () => {
    withFixture((repositoryRoot) => {
      const errors: string[] = [];
      const run: CommandRunner = () => {
        throw new Error('npm must not run');
      };
      const options = {
        repositoryRoot,
        run,
        stdout: console,
        stderr: { error: (message: string) => errors.push(message) },
      };

      expect(runSelectIamDataCli({ ...options, args: ['0.21.3', 'extra'] })).toBe(1);
      expect(runSelectIamDataCli({ ...options, args: ['invalid'] })).toBe(1);
      expect(errors).toEqual([
        'usage: tsx scripts/select-iam-data.ts [exact-version]',
        'Selected IAM data version must be an exact numeric version like 0.21.202608081: invalid',
      ]);
    });
  });
});
