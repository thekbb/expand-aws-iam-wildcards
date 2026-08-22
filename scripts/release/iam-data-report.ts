import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  LOCKED_CATALOG_MINIMUMS,
  type IamCatalogMinimums,
} from '../iam-data/catalog.js';
import { readIamCatalog } from '../iam-data/generator.js';
import {
  IAM_DATA_PACKAGE,
  installedIamDataDirectory,
} from './iam-data.js';

interface InstalledPackageJson {
  readonly version?: string;
}

export interface IamDataReport {
  readonly actionCount: number;
  readonly serviceCount: number;
  readonly version: string;
}

export interface IamDataReportDestinations {
  readonly githubOutputPath?: string;
  readonly githubSummaryPath?: string;
}

export function createIamDataReport(
  repositoryRoot: string,
  minimums: IamCatalogMinimums = LOCKED_CATALOG_MINIMUMS,
): IamDataReport {
  const resolvedRepository = resolve(repositoryRoot);
  const installedPackagePath = join(
    resolvedRepository,
    'node_modules',
    IAM_DATA_PACKAGE,
    'package.json',
  );
  const installedPackage = JSON.parse(
    readFileSync(installedPackagePath, 'utf8'),
  ) as InstalledPackageJson;
  if (installedPackage.version === undefined) {
    throw new Error(`Installed ${IAM_DATA_PACKAGE} package metadata is missing a version`);
  }

  const catalog = readIamCatalog(installedIamDataDirectory(resolvedRepository), minimums);
  return {
    actionCount: catalog.actions.length,
    serviceCount: Object.keys(catalog.serviceDocSlugs).length,
    version: installedPackage.version,
  };
}

export function writeIamDataReport(
  report: IamDataReport,
  destinations: IamDataReportDestinations,
): void {
  if (destinations.githubOutputPath !== undefined) {
    appendFileSync(
      destinations.githubOutputPath,
      `version=${report.version}\naction_count=${report.actionCount}\nservice_count=${report.serviceCount}\n`,
    );
  }
  if (destinations.githubSummaryPath !== undefined) {
    appendFileSync(
      destinations.githubSummaryPath,
      [
        '## Locked IAM catalog',
        '',
        '| Package | Version | Actions | Services |',
        '| --- | --- | ---: | ---: |',
        `| ${IAM_DATA_PACKAGE} | ${report.version} | ${report.actionCount} | ${report.serviceCount} |`,
        '',
      ].join('\n'),
    );
  }
}
