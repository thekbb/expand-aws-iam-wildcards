import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, posix, resolve } from 'node:path';

import {
  LOCKED_CATALOG_MINIMUMS,
  type IamCatalogMinimums,
} from '../iam-data/catalog.js';
import {
  generateIamData,
  type IamDataGenerationResult,
} from '../iam-data/generator.js';
import { installedIamDataDirectory } from './iam-data.js';

const GENERATED_CATALOG_MODULES = new Set([
  'iam-actions.ts',
  'service-doc-slugs.ts',
]);

export interface GeneratedBuildWorkspace {
  readonly rootDirectory: string;
  readonly entryPoint: string;
  readonly catalog: IamDataGenerationResult;
}

export interface BuildWorkspaceOptions {
  readonly dataDirectory?: string;
  readonly minimums?: IamCatalogMinimums;
}

function assertRegularDirectory(directory: string, label: string): void {
  const status = lstatSync(directory);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error(`${label} must be a regular directory: ${directory}`);
  }
}

function copySourceTree(
  sourceDirectory: string,
  destinationDirectory: string,
  relativeDirectory = '',
): void {
  const currentSource = join(sourceDirectory, relativeDirectory);
  const currentDestination = join(destinationDirectory, relativeDirectory);
  mkdirSync(currentDestination, { recursive: true });

  for (const entry of readdirSync(currentSource, { withFileTypes: true })) {
    const relativePath = posix.join(relativeDirectory, entry.name);
    if (relativeDirectory === '' && GENERATED_CATALOG_MODULES.has(entry.name)) continue;

    if (entry.isSymbolicLink()) {
      throw new Error(`Build source must not contain symbolic links: src/${relativePath}`);
    }
    if (entry.isDirectory()) {
      copySourceTree(sourceDirectory, destinationDirectory, relativePath);
    } else if (entry.isFile()) {
      copyFileSync(join(sourceDirectory, relativePath), join(destinationDirectory, relativePath));
    } else {
      throw new Error(`Build source contains an unsupported entry: src/${relativePath}`);
    }
  }
}

export function withGeneratedBuildWorkspace<T>(
  repositoryRoot: string,
  useWorkspace: (workspace: GeneratedBuildWorkspace) => T,
  options: BuildWorkspaceOptions = {},
): T {
  const resolvedRepository = resolve(repositoryRoot);
  const sourceDirectory = join(resolvedRepository, 'src');
  assertRegularDirectory(sourceDirectory, 'Build source');

  const buildRoot = join(resolvedRepository, '.build');
  if (existsSync(buildRoot)) {
    assertRegularDirectory(buildRoot, 'Build root');
  } else {
    mkdirSync(buildRoot);
  }

  const workspaceRoot = join(buildRoot, 'workspace');
  if (existsSync(workspaceRoot)) {
    throw new Error(`Build workspace already exists: ${workspaceRoot}`);
  }

  const workspaceSource = join(workspaceRoot, 'src');
  mkdirSync(workspaceRoot);
  try {
    copySourceTree(sourceDirectory, workspaceSource);
    const catalog = generateIamData({
      dataDirectory: options.dataDirectory ?? installedIamDataDirectory(resolvedRepository),
      outputDirectory: workspaceSource,
      repositoryRoot: resolvedRepository,
      minimums: options.minimums ?? LOCKED_CATALOG_MINIMUMS,
    });
    const entryPoint = join(workspaceSource, 'index.ts');
    if (!existsSync(entryPoint) || !lstatSync(entryPoint).isFile()) {
      throw new Error('Build source is missing src/index.ts');
    }

    return useWorkspace({ rootDirectory: workspaceRoot, entryPoint, catalog });
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
  }
}
