import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';

const RELEASE_FILE = 'index.js';
const NCC_AUXILIARY_OUTPUTS = ['licenses.txt', 'package.json', 'src', 'scripts'] as const;

export type BundleCompiler = (outputDirectory: string) => void;

function artifactPath(relativePath: string): string {
  return `dist/${relativePath}`;
}

function listFiles(directory: string, relativeDirectory = ''): string[] {
  const currentDirectory = join(directory, relativeDirectory);
  if (!existsSync(currentDirectory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const relativePath = posix.join(relativeDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Unexpected symbolic link in build output: ${artifactPath(relativePath)}`);
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(directory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unexpected entry in build output: ${artifactPath(relativePath)}`);
    }
  }
  return files.sort();
}

function removeNccAuxiliaryOutputs(outputDirectory: string): void {
  for (const relativePath of NCC_AUXILIARY_OUTPUTS) {
    rmSync(join(outputDirectory, relativePath), { force: true, recursive: true });
  }
}

export function assertBundleOutput(directory: string, label: string): void {
  const files = listFiles(directory);
  const errors: string[] = [];

  if (!files.includes(RELEASE_FILE)) {
    errors.push(`Missing ${label} artifact: ${artifactPath(RELEASE_FILE)}`);
  }
  for (const file of files) {
    if (file !== RELEASE_FILE) {
      errors.push(`Unexpected ${label} artifact: ${artifactPath(file)}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
}

export function assertBundlesMatch(
  expectedDirectory: string,
  actualDirectory: string,
  label: string,
): void {
  assertBundleOutput(expectedDirectory, 'generated');
  assertBundleOutput(actualDirectory, 'committed');

  const expected = readFileSync(join(expectedDirectory, RELEASE_FILE));
  const actual = readFileSync(join(actualDirectory, RELEASE_FILE));
  if (!expected.equals(actual)) {
    throw new Error(`${label} differs: ${artifactPath(RELEASE_FILE)}`);
  }
}

export function withTemporaryBundle<T>(
  compile: BundleCompiler,
  useBundle: (outputDirectory: string) => T,
): T {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'expand-aws-iam-wildcards-build-'));
  const outputDirectory = join(temporaryRoot, 'dist');

  try {
    mkdirSync(outputDirectory, { recursive: true });
    compile(outputDirectory);
    removeNccAuxiliaryOutputs(outputDirectory);
    assertBundleOutput(outputDirectory, 'generated');
    return useBundle(outputDirectory);
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

function assertReplaceableDist(directory: string): void {
  if (!existsSync(directory)) return;
  const status = lstatSync(directory);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error('Refusing to replace dist because it is not a regular directory');
  }
  listFiles(directory);
}

export function writeCommittedBundle(repositoryRoot: string, compile: BundleCompiler): void {
  const committedDist = resolve(repositoryRoot, 'dist');

  withTemporaryBundle(compile, (generatedDist) => {
    assertReplaceableDist(committedDist);
    rmSync(committedDist, { force: true, recursive: true });
    mkdirSync(committedDist, { recursive: true });
    copyFileSync(join(generatedDist, RELEASE_FILE), join(committedDist, RELEASE_FILE));
  });
}

export function checkCommittedBundle(repositoryRoot: string, compile: BundleCompiler): void {
  const committedDist = resolve(repositoryRoot, 'dist');

  withTemporaryBundle(compile, (firstBuild) => {
    withTemporaryBundle(compile, (secondBuild) => {
      assertBundlesMatch(firstBuild, secondBuild, 'Repeated build');
      assertBundlesMatch(firstBuild, committedDist, 'Committed bundle');
    });
  });
}
