import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCKED_CATALOG_MINIMUMS } from '../iam-data/catalog.js';
import {
  createIamDataReport,
  type IamDataReport,
  writeIamDataReport,
} from './iam-data-report.js';
import { IAM_DATA_PACKAGE } from './iam-data.js';

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'iam-data-report-test-'));
  try {
    return useFixture(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function writeFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function writePackageState(
  directory: string,
  installedVersion: string,
): string {
  const installedPackage = join(directory, 'node_modules', IAM_DATA_PACKAGE);
  writeFile(join(installedPackage, 'package.json'), JSON.stringify({ version: installedVersion }));
  return installedPackage;
}

function writeSmallCatalog(installedPackage: string): void {
  writeFile(join(installedPackage, 'data/actions/s3.json'), JSON.stringify({
    getObject: { name: 'GetObject' },
  }));
  writeFile(
    join(installedPackage, 'data/serviceNames.json'),
    JSON.stringify({ s3: 'Amazon S3' }),
  );
}

describe('createIamDataReport', () => {
  it('reports the real locked catalog against production floors', () => {
    withFixture((directory) => {
      const repositoryRoot = resolve(import.meta.dirname, '../..');
      const realInstalledPackage = join(repositoryRoot, 'node_modules', IAM_DATA_PACKAGE);
      const installedMetadata = JSON.parse(
        readFileSync(join(realInstalledPackage, 'package.json'), 'utf8'),
      ) as { version: string };
      const fixturePackage = writePackageState(directory, installedMetadata.version);
      symlinkSync(join(realInstalledPackage, 'data'), join(fixturePackage, 'data'));

      const report = createIamDataReport(directory);

      expect(report.version).toBe(installedMetadata.version);
      expect(report.actionCount).toBeGreaterThanOrEqual(LOCKED_CATALOG_MINIMUMS.actionCount);
      expect(report.serviceCount).toBeGreaterThanOrEqual(LOCKED_CATALOG_MINIMUMS.serviceCount);
    });
  });

  it('reports a valid installed fixture catalog', () => {
    withFixture((directory) => {
      const installedPackage = writePackageState(directory, '0.21.2');
      writeSmallCatalog(installedPackage);

      expect(createIamDataReport(
        directory,
        { actionCount: 1, serviceCount: 1 },
      )).toEqual({
        actionCount: 1,
        serviceCount: 1,
        version: '0.21.2',
      });
    });
  });

  it('rejects missing installed version metadata', () => {
    withFixture((directory) => {
      const installedPackage = writePackageState(directory, '0.21.2');
      writeFile(join(installedPackage, 'package.json'), '{}');

      expect(() => createIamDataReport(
        directory,
        { actionCount: 1, serviceCount: 1 },
      )).toThrow(
        `Installed ${IAM_DATA_PACKAGE} package metadata is missing a version`,
      );
    });
  });

  it('enforces catalog production floors', () => {
    withFixture((directory) => {
      const installedPackage = writePackageState(directory, '0.21.2');
      writeSmallCatalog(installedPackage);

      expect(() => createIamDataReport(
        directory,
        { actionCount: 2, serviceCount: 1 },
      )).toThrow('IAM catalog has 1 actions; expected at least 2');
    });
  });
});

describe('writeIamDataReport', () => {
  const report: IamDataReport = {
    actionCount: 21_234,
    serviceCount: 456,
    version: '0.21.202608201',
  };

  it('appends GitHub outputs and a readable step summary', () => {
    withFixture((directory) => {
      const outputPath = join(directory, 'output');
      const summaryPath = join(directory, 'summary');
      writeFile(outputPath, 'existing=true\n');
      writeFile(summaryPath, 'Existing summary\n\n');

      writeIamDataReport(report, {
        githubOutputPath: outputPath,
        githubSummaryPath: summaryPath,
      });

      expect(readFileSync(outputPath, 'utf8')).toBe([
        'existing=true',
        'version=0.21.202608201',
        'action_count=21234',
        'service_count=456',
        '',
      ].join('\n'));
      expect(readFileSync(summaryPath, 'utf8')).toContain(
        '## Locked IAM catalog',
      );
      expect(readFileSync(summaryPath, 'utf8')).toContain(
        '| @cloud-copilot/iam-data | 0.21.202608201 | 21234 | 456 |',
      );
    });
  });

  it('allows local reporting without GitHub destination files', () => {
    expect(() => writeIamDataReport(report, {})).not.toThrow();
  });
});
