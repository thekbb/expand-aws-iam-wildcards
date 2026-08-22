import { type ReleaseRuntime, runChecked } from './command.js';

export const RELEASE_MANAGED_FILES = [
  'CHANGELOG.md',
  'dist/index.js',
  'package-lock.json',
  'package.json',
];

function statusPath(line: string): string {
  const path = line.slice(3);
  const renameSeparator = ' -> ';
  const renameIndex = path.indexOf(renameSeparator);
  return renameIndex === -1 ? path : path.slice(renameIndex + renameSeparator.length);
}

export function unexpectedReleaseFiles(
  porcelainStatus: string,
  managedFiles: readonly string[] = RELEASE_MANAGED_FILES,
): string[] {
  const allowed = new Set(managedFiles);
  return [...new Set(porcelainStatus
    .split('\n')
    .filter((line) => line !== '')
    .map(statusPath)
    .filter((path) => !allowed.has(path)))]
    .sort();
}

export function assertOnlyReleaseManagedFilesChanged(
  porcelainStatus: string,
  managedFiles: readonly string[] = RELEASE_MANAGED_FILES,
): void {
  const unexpected = unexpectedReleaseFiles(porcelainStatus, managedFiles);
  if (unexpected.length > 0) {
    throw new Error(`Release preparation changed unmanaged file(s): ${unexpected.join(', ')}`);
  }
}

export function checkReleaseManagedFiles(runtime: ReleaseRuntime): void {
  const status = runChecked(runtime, 'git', [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]).stdout;
  assertOnlyReleaseManagedFilesChanged(status);
}
