import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type CommandRunner } from './command.js';

export const IAM_DATA_PACKAGE = '@cloud-copilot/iam-data';
const IAM_DATA_LOCK_PATH = `node_modules/${IAM_DATA_PACKAGE}`;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

interface PackageJson {
  readonly devDependencies?: Readonly<Record<string, string>>;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, {
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly version?: string;
  }>>;
}

export interface IamDataSelection {
  readonly changed: boolean;
  readonly previousVersion: string;
  readonly selectedVersion: string;
}

function parseVersion(version: string, label: string): readonly [bigint, bigint, bigint] {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must be an exact numeric version like 0.21.202608081: ${version}`);
  }
  return version.split('.').map((part) => BigInt(part)) as [bigint, bigint, bigint];
}

export function compareIamDataVersions(left: string, right: string): number {
  const leftParts = parseVersion(left, 'IAM data version');
  const rightParts = parseVersion(right, 'IAM data version');

  for (const index of [0, 1, 2] as const) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function installedIamDataDirectory(repositoryRoot: string): string {
  return join(resolve(repositoryRoot), 'node_modules', IAM_DATA_PACKAGE, 'data');
}

export function lockedIamDataVersion(repositoryRoot: string): string {
  const lockfile = readJson<PackageLock>(join(repositoryRoot, 'package-lock.json'));
  const version = lockfile.packages?.[IAM_DATA_LOCK_PATH]?.version;
  if (version === undefined) {
    throw new Error(`package-lock.json is missing ${IAM_DATA_LOCK_PATH}`);
  }
  parseVersion(version, 'Locked IAM data version');
  return version;
}

function runNpm(run: CommandRunner, args: readonly string[]): string {
  const result = run('npm', args);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit status ${result.status}`;
    throw new Error(`npm ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export function assertRecordedIamDataVersion(
  repositoryRoot: string,
  selectedVersion: string,
): void {
  const packageJson = readJson<PackageJson>(join(repositoryRoot, 'package.json'));
  const lockfile = readJson<PackageLock>(join(repositoryRoot, 'package-lock.json'));
  const manifestVersion = packageJson.devDependencies?.[IAM_DATA_PACKAGE];
  const lockManifestVersion = lockfile.packages?.['']?.devDependencies?.[IAM_DATA_PACKAGE];
  const lockedVersion = lockfile.packages?.[IAM_DATA_LOCK_PATH]?.version;

  if (
    manifestVersion !== selectedVersion ||
    lockManifestVersion !== selectedVersion ||
    lockedVersion !== selectedVersion
  ) {
    throw new Error(
      `npm did not record ${IAM_DATA_PACKAGE}@${selectedVersion} exactly in package metadata and the lockfile`,
    );
  }
}

export function selectIamDataVersion(
  repositoryRoot: string,
  requestedVersion: string | undefined,
  run: CommandRunner,
): IamDataSelection {
  const resolvedRepository = resolve(repositoryRoot);
  const previousVersion = lockedIamDataVersion(resolvedRepository);
  const selectedVersion = requestedVersion ?? runNpm(run, ['view', IAM_DATA_PACKAGE, 'version']);
  parseVersion(selectedVersion, 'Selected IAM data version');

  if (compareIamDataVersions(selectedVersion, previousVersion) < 0) {
    throw new Error(
      `Refusing to downgrade ${IAM_DATA_PACKAGE} from ${previousVersion} to ${selectedVersion}`,
    );
  }

  runNpm(run, [
    'install',
    '--save-dev',
    '--save-exact',
    '--package-lock-only',
    `${IAM_DATA_PACKAGE}@${selectedVersion}`,
  ]);
  assertRecordedIamDataVersion(resolvedRepository, selectedVersion);

  return {
    changed: selectedVersion !== previousVersion,
    previousVersion,
    selectedVersion,
  };
}
