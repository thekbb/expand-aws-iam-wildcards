import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type CommandResult, type CommandRunner } from './command.js';
import {
  compareIamDataVersions,
  IAM_DATA_PACKAGE,
  selectIamDataVersion,
} from './iam-data.js';

const LOCK_PATH = `node_modules/${IAM_DATA_PACKAGE}`;

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'iam-data-selection-test-'));
  try {
    return useFixture(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function writePackageState(
  directory: string,
  manifestVersion: string | undefined,
  lockManifestVersion: string | undefined,
  lockedVersion: string | undefined,
): void {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    devDependencies: manifestVersion === undefined ? {} : { [IAM_DATA_PACKAGE]: manifestVersion },
  }));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
    packages: {
      '': {
        devDependencies: lockManifestVersion === undefined
          ? {}
          : { [IAM_DATA_PACKAGE]: lockManifestVersion },
      },
      [LOCK_PATH]: lockedVersion === undefined ? {} : { version: lockedVersion },
    },
  }));
}

function result(stdout = '', status = 0, stderr = ''): CommandResult {
  return { status, stderr, stdout };
}

function updatingRunner(
  directory: string,
  selectedVersion: string,
  calls: string[],
  recordedVersions: readonly [string | undefined, string | undefined, string | undefined] = [
    selectedVersion,
    selectedVersion,
    selectedVersion,
  ],
): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'view') return result(`${selectedVersion}\n`);
    writePackageState(directory, ...recordedVersions);
    return result();
  };
}

describe('compareIamDataVersions', () => {
  it('compares numeric version components without lexical ordering', () => {
    expect(compareIamDataVersions('0.21.10', '0.21.9')).toBe(1);
    expect(compareIamDataVersions('0.20.99', '0.21.1')).toBe(-1);
    expect(compareIamDataVersions('0.21.9', '0.21.9')).toBe(0);
  });

  it('rejects ranges, prereleases, and incomplete versions', () => {
    expect(() => compareIamDataVersions('^0.21.1', '0.21.1')).toThrow(
      'IAM data version must be an exact numeric version',
    );
    expect(() => compareIamDataVersions('0.21.2-beta.1', '0.21.1')).toThrow(
      'IAM data version must be an exact numeric version',
    );
    expect(() => compareIamDataVersions('0.21', '0.21.1')).toThrow(
      'IAM data version must be an exact numeric version',
    );
  });
});

describe('selectIamDataVersion', () => {
  it('selects the registry version and records it exactly', () => {
    withFixture((directory) => {
      writePackageState(directory, '^0.21.202607301', '^0.21.202607301', '0.21.202608081');
      const calls: string[] = [];

      expect(selectIamDataVersion(
        directory,
        undefined,
        updatingRunner(directory, '0.21.202608201', calls),
      )).toEqual({
        changed: true,
        previousVersion: '0.21.202608081',
        selectedVersion: '0.21.202608201',
      });
      expect(calls).toEqual([
        `npm view ${IAM_DATA_PACKAGE} version`,
        `npm install --save-dev --save-exact ${IAM_DATA_PACKAGE}@0.21.202608201`,
      ]);
      expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
        .toMatchObject({ devDependencies: { [IAM_DATA_PACKAGE]: '0.21.202608201' } });
    });
  });

  it('keeps an unchanged version while normalizing its manifest entry', () => {
    withFixture((directory) => {
      writePackageState(directory, '^0.21.1', '^0.21.1', '0.21.2');
      const calls: string[] = [];

      expect(selectIamDataVersion(
        directory,
        '0.21.2',
        updatingRunner(directory, '0.21.2', calls),
      )).toEqual({
        changed: false,
        previousVersion: '0.21.2',
        selectedVersion: '0.21.2',
      });
      expect(calls).toEqual([
        `npm install --save-dev --save-exact ${IAM_DATA_PACKAGE}@0.21.2`,
      ]);
    });
  });

  it('rejects invalid and downgraded selections before installation', () => {
    withFixture((directory) => {
      writePackageState(directory, '0.21.2', '0.21.2', '0.21.2');
      const run: CommandRunner = () => {
        throw new Error('npm must not run');
      };

      expect(() => selectIamDataVersion(directory, 'latest', run)).toThrow(
        'Selected IAM data version must be an exact numeric version',
      );
      expect(() => selectIamDataVersion(directory, '0.21.1', run)).toThrow(
        `Refusing to downgrade ${IAM_DATA_PACKAGE} from 0.21.2 to 0.21.1`,
      );
    });
  });

  it('rejects an invalid registry selection', () => {
    withFixture((directory) => {
      writePackageState(directory, '0.21.2', '0.21.2', '0.21.2');
      const run: CommandRunner = () => result('not-a-version\n');

      expect(() => selectIamDataVersion(directory, undefined, run)).toThrow(
        'Selected IAM data version must be an exact numeric version',
      );
    });
  });

  it.each([
    ['package.json', undefined, '0.21.3', '0.21.3'],
    ['package-lock.json manifest', '0.21.3', undefined, '0.21.3'],
    ['package-lock.json package', '0.21.3', '0.21.3', '0.21.2'],
  ] as const)('rejects a mismatched %s version after npm install', (
    _label,
    manifestVersion,
    lockManifestVersion,
    lockedVersion,
  ) => {
    withFixture((directory) => {
      writePackageState(directory, '0.21.2', '0.21.2', '0.21.2');

      expect(() => selectIamDataVersion(
        directory,
        '0.21.3',
        updatingRunner(directory, '0.21.3', [], [
          manifestVersion,
          lockManifestVersion,
          lockedVersion,
        ]),
      )).toThrow(`npm did not record ${IAM_DATA_PACKAGE}@0.21.3 exactly`);
    });
  });

  it('reports npm failures with stderr or exit status', () => {
    withFixture((directory) => {
      writePackageState(directory, '0.21.2', '0.21.2', '0.21.2');
      const registryFailure: CommandRunner = () => result('', 1, 'registry unavailable\n');
      expect(() => selectIamDataVersion(directory, undefined, registryFailure)).toThrow(
        `npm view ${IAM_DATA_PACKAGE} version failed: registry unavailable`,
      );

      const installFailure: CommandRunner = () => result('', 9);
      expect(() => selectIamDataVersion(directory, '0.21.3', installFailure)).toThrow(
        `npm install --save-dev --save-exact ${IAM_DATA_PACKAGE}@0.21.3 failed: exit status 9`,
      );
    });
  });

  it('rejects a missing or malformed locked version', () => {
    withFixture((directory) => {
      writePackageState(directory, '0.21.2', '0.21.2', undefined);
      expect(() => selectIamDataVersion(directory, '0.21.3', () => result())).toThrow(
        `package-lock.json is missing ${LOCK_PATH}`,
      );

      writePackageState(directory, '0.21.2', '0.21.2', 'not-a-version');
      expect(() => selectIamDataVersion(directory, '0.21.3', () => result())).toThrow(
        'Locked IAM data version must be an exact numeric version',
      );
    });
  });
});
