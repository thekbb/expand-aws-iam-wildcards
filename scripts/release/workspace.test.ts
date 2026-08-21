import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LOCKED_CATALOG_MINIMUMS } from '../iam-data/catalog.js';
import { withGeneratedBuildWorkspace } from './workspace.js';

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'build-workspace-test-'));
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

function createRepository(directory: string): string {
  const repositoryRoot = join(directory, 'repository');
  writeFile(join(repositoryRoot, 'src/index.ts'), "import './iam-actions.js';\n");
  writeFile(join(repositoryRoot, 'src/nested/helper.ts'), 'export const helper = true;\n');
  writeFile(join(repositoryRoot, 'src/iam-actions.ts'), 'tracked actions sentinel\n');
  writeFile(join(repositoryRoot, 'src/service-doc-slugs.ts'), 'tracked slugs sentinel\n');
  return repositoryRoot;
}

function createDataFixture(directory: string): string {
  const dataDirectory = join(directory, 'iam-data');
  writeFile(join(dataDirectory, 'actions/s3.json'), JSON.stringify({
    getObject: { name: 'GetObject' },
  }));
  writeFile(join(dataDirectory, 'serviceNames.json'), JSON.stringify({ s3: 'Amazon S3' }));
  return dataDirectory;
}

describe('withGeneratedBuildWorkspace', () => {
  it('replaces tracked catalog modules with data from the locked package', () => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      let workspaceRoot = '';

      withGeneratedBuildWorkspace(repositoryRoot, (workspace) => {
        workspaceRoot = workspace.rootDirectory;
        expect(workspace.catalog.actionCount).toBeGreaterThanOrEqual(
          LOCKED_CATALOG_MINIMUMS.actionCount,
        );
        expect(workspace.catalog.serviceCount).toBeGreaterThanOrEqual(
          LOCKED_CATALOG_MINIMUMS.serviceCount,
        );
        expect(readFileSync(join(workspace.rootDirectory, 'src/nested/helper.ts'), 'utf8')).toBe(
          'export const helper = true;\n',
        );
        expect(readFileSync(join(workspace.rootDirectory, 'src/iam-actions.ts'), 'utf8'))
          .not.toContain('tracked actions sentinel');
        expect(readFileSync(join(workspace.rootDirectory, 'src/service-doc-slugs.ts'), 'utf8'))
          .not.toContain('tracked slugs sentinel');
      });

      expect(existsSync(workspaceRoot)).toBe(false);
      expect(readdirSync(join(repositoryRoot, '.build'))).toEqual([]);
    });
  });

  it('cleans the workspace when its consumer fails', () => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const dataDirectory = createDataFixture(directory);
      let workspaceRoot = '';

      expect(() => withGeneratedBuildWorkspace(repositoryRoot, (workspace) => {
        workspaceRoot = workspace.rootDirectory;
        throw new Error('compiler failed');
      }, { dataDirectory, minimums: { actionCount: 1, serviceCount: 1 } })).toThrow(
        'compiler failed',
      );

      expect(existsSync(workspaceRoot)).toBe(false);
    });
  });

  it('refuses an existing workspace without deleting it', () => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const preservedFile = join(repositoryRoot, '.build/workspace/preserved');
      writeFile(preservedFile, 'keep me');

      expect(() => withGeneratedBuildWorkspace(repositoryRoot, () => undefined)).toThrow(
        `Build workspace already exists: ${join(repositoryRoot, '.build/workspace')}`,
      );
      expect(readFileSync(preservedFile, 'utf8')).toBe('keep me');
    });
  });

  it('rejects symbolic links in copied source and cleans up', () => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const linkedSource = join(repositoryRoot, 'linked-source.ts');
      writeFile(linkedSource, 'outside source\n');
      symlinkSync(linkedSource, join(repositoryRoot, 'src/linked.ts'));

      expect(() => withGeneratedBuildWorkspace(repositoryRoot, () => undefined)).toThrow(
        'Build source must not contain symbolic links: src/linked.ts',
      );
      expect(existsSync(join(repositoryRoot, '.build/workspace'))).toBe(false);
      expect(readFileSync(linkedSource, 'utf8')).toBe('outside source\n');
    });
  });

  it.each(['file', 'symbolic link'] as const)('rejects a %s at the build root', (kind) => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const buildRoot = join(repositoryRoot, '.build');
      if (kind === 'file') {
        writeFile(buildRoot, 'not a directory');
      } else {
        const linkedDirectory = join(repositoryRoot, 'linked-build-root');
        mkdirSync(linkedDirectory);
        writeFile(join(linkedDirectory, 'preserved'), 'keep me');
        symlinkSync(linkedDirectory, buildRoot);
      }

      expect(() => withGeneratedBuildWorkspace(repositoryRoot, () => undefined)).toThrow(
        `Build root must be a regular directory: ${buildRoot}`,
      );
      if (kind === 'symbolic link') {
        expect(readFileSync(join(repositoryRoot, 'linked-build-root/preserved'), 'utf8')).toBe(
          'keep me',
        );
      }
    });
  });

  it.each(['missing', 'directory'] as const)('rejects a %s entry point', (kind) => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const dataDirectory = createDataFixture(directory);
      const entryPoint = join(repositoryRoot, 'src/index.ts');
      rmSync(entryPoint);
      if (kind === 'directory') mkdirSync(entryPoint);

      expect(() => withGeneratedBuildWorkspace(
        repositoryRoot,
        () => undefined,
        { dataDirectory, minimums: { actionCount: 1, serviceCount: 1 } },
      )).toThrow('Build source is missing src/index.ts');
      expect(existsSync(join(repositoryRoot, '.build/workspace'))).toBe(false);
    });
  });

  it('rejects special filesystem entries in source without blocking', () => {
    withFixture((directory) => {
      const repositoryRoot = createRepository(directory);
      const fifoPath = join(repositoryRoot, 'src/input.fifo');
      execFileSync('mkfifo', [fifoPath]);

      expect(() => withGeneratedBuildWorkspace(repositoryRoot, () => undefined)).toThrow(
        'Build source contains an unsupported entry: src/input.fifo',
      );
      expect(existsSync(join(repositoryRoot, '.build/workspace'))).toBe(false);
    });
  });
});
