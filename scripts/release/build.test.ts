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
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertBundleOutput,
  assertBundlesMatch,
  type BundleCompiler,
  checkCommittedBundle,
  withTemporaryBundle,
  withTemporaryBundleAsync,
  writeCommittedBundle,
} from './build.js';

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'build-test-'));
  try {
    return useFixture(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function writeFiles(directory: string, files: Readonly<Record<string, string>>): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(directory, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

function compiler(files: Readonly<Record<string, string>>): BundleCompiler {
  return (outputDirectory) => writeFiles(outputDirectory, files);
}

describe('build output validation', () => {
  it('accepts the single runtime bundle', () => {
    withFixture((directory) => {
      writeFiles(directory, { 'index.js': 'bundle' });
      expect(() => assertBundleOutput(directory, 'generated')).not.toThrow();
    });
  });

  it('reports missing and unexpected artifacts with exact paths', () => {
    withFixture((directory) => {
      writeFiles(directory, { 'nested/debug.js': 'debug' });
      expect(() => assertBundleOutput(directory, 'generated')).toThrow([
        'Missing generated artifact: dist/index.js',
        'Unexpected generated artifact: dist/nested/debug.js',
      ].join('\n'));
    });
  });

  it('reports changed bundle contents', () => {
    withFixture((directory) => {
      const expected = join(directory, 'expected');
      const actual = join(directory, 'actual');
      writeFiles(expected, { 'index.js': 'first' });
      writeFiles(actual, { 'index.js': 'second' });

      expect(() => assertBundlesMatch(expected, actual, 'Build')).toThrow(
        'Build differs: dist/index.js',
      );
    });
  });

  it('removes ncc helper output before installing the bundle', () => {
    withFixture((repositoryRoot) => {
      writeFiles(join(repositoryRoot, 'dist'), {
        'index.js': 'old bundle',
        'old.js': 'old artifact',
      });

      writeCommittedBundle(repositoryRoot, compiler({
        'index.js': 'new bundle',
        'licenses.txt': 'licenses',
        'package.json': '{}',
        'scripts/helper.js': 'helper',
        'src/source.ts': 'source',
      }));

      expect(readdirSync(join(repositoryRoot, 'dist'))).toEqual(['index.js']);
      expect(readFileSync(join(repositoryRoot, 'dist/index.js'), 'utf8')).toBe('new bundle');
    });
  });

  it('creates dist when it does not exist', () => {
    withFixture((repositoryRoot) => {
      writeCommittedBundle(repositoryRoot, compiler({ 'index.js': 'new bundle' }));

      expect(readFileSync(join(repositoryRoot, 'dist/index.js'), 'utf8')).toBe('new bundle');
    });
  });

  it('checks two clean builds and the committed bundle', () => {
    withFixture((repositoryRoot) => {
      writeFiles(join(repositoryRoot, 'dist'), { 'index.js': 'same bundle' });
      let compileCount = 0;
      const compile: BundleCompiler = (outputDirectory) => {
        compileCount += 1;
        writeFiles(outputDirectory, { 'index.js': 'same bundle' });
      };

      expect(() => checkCommittedBundle(repositoryRoot, compile)).not.toThrow();
      expect(compileCount).toBe(2);
    });
  });

  it('rejects nondeterministic repeated builds', () => {
    withFixture((repositoryRoot) => {
      writeFiles(join(repositoryRoot, 'dist'), { 'index.js': 'bundle 1' });
      let compileCount = 0;
      const compile: BundleCompiler = (outputDirectory) => {
        compileCount += 1;
        writeFiles(outputDirectory, { 'index.js': `bundle ${compileCount}` });
      };

      expect(() => checkCommittedBundle(repositoryRoot, compile)).toThrow(
        'Repeated build differs: dist/index.js',
      );
    });
  });

  it('rejects stale committed file sets', () => {
    withFixture((repositoryRoot) => {
      writeFiles(join(repositoryRoot, 'dist'), {
        'index.js': 'bundle',
        'unexpected.js': 'unexpected',
      });

      expect(() => checkCommittedBundle(repositoryRoot, compiler({ 'index.js': 'bundle' }))).toThrow(
        'Unexpected committed artifact: dist/unexpected.js',
      );
    });
  });

  it('reports a missing committed bundle with its exact path', () => {
    withFixture((repositoryRoot) => {
      expect(() => checkCommittedBundle(repositoryRoot, compiler({ 'index.js': 'bundle' }))).toThrow(
        'Missing committed artifact: dist/index.js',
      );
    });
  });

  it('preserves the committed bundle when compilation fails', () => {
    withFixture((repositoryRoot) => {
      const committedBundle = join(repositoryRoot, 'dist/index.js');
      writeFiles(join(repositoryRoot, 'dist'), { 'index.js': 'existing bundle' });

      expect(() => writeCommittedBundle(repositoryRoot, () => {
        throw new Error('compiler failed');
      })).toThrow('compiler failed');
      expect(readFileSync(committedBundle, 'utf8')).toBe('existing bundle');
    });
  });

  it('does not modify dist when verification fails', () => {
    withFixture((repositoryRoot) => {
      const committedDist = join(repositoryRoot, 'dist');
      writeFiles(committedDist, {
        'index.js': 'existing bundle',
        'unexpected.js': 'existing extra file',
      });

      expect(() => checkCommittedBundle(
        repositoryRoot,
        compiler({ 'index.js': 'new bundle' }),
      )).toThrow('Unexpected committed artifact: dist/unexpected.js');
      expect(readFileSync(join(committedDist, 'index.js'), 'utf8')).toBe('existing bundle');
      expect(readFileSync(join(committedDist, 'unexpected.js'), 'utf8')).toBe('existing extra file');
    });
  });

  it('cleans temporary output after compiler failure', () => {
    let outputDirectory = '';
    expect(() => withTemporaryBundle((output) => {
      outputDirectory = output;
      throw new Error('compiler failed');
    }, () => undefined)).toThrow('compiler failed');
    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('keeps temporary output available for asynchronous verification and cleans it afterward', async () => {
    let outputDirectory = '';

    await expect(withTemporaryBundleAsync(
      compiler({ 'index.js': 'bundle' }),
      async (output) => {
        outputDirectory = output;
        await Promise.resolve();
        expect(readFileSync(join(output, 'index.js'), 'utf8')).toBe('bundle');
        return 'verified';
      },
    )).resolves.toBe('verified');

    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('cleans asynchronous temporary output after verification fails', async () => {
    let outputDirectory = '';

    await expect(withTemporaryBundleAsync(
      compiler({ 'index.js': 'bundle' }),
      async (output) => {
        outputDirectory = output;
        await Promise.resolve();
        throw new Error('verification failed');
      },
    )).rejects.toThrow('verification failed');

    expect(existsSync(outputDirectory)).toBe(false);
  });

  it('refuses to replace a symbolic dist directory', () => {
    withFixture((repositoryRoot) => {
      const realDirectory = join(repositoryRoot, 'real-dist');
      mkdirSync(realDirectory);
      symlinkSync(realDirectory, join(repositoryRoot, 'dist'));

      expect(() => writeCommittedBundle(repositoryRoot, compiler({ 'index.js': 'bundle' }))).toThrow(
        'Refusing to replace dist because it is not a regular directory',
      );
      expect(existsSync(realDirectory)).toBe(true);
    });
  });

  it('refuses to replace a regular file at dist', () => {
    withFixture((repositoryRoot) => {
      const distPath = join(repositoryRoot, 'dist');
      writeFileSync(distPath, 'not a directory');

      expect(() => writeCommittedBundle(repositoryRoot, compiler({ 'index.js': 'bundle' }))).toThrow(
        'Refusing to replace dist because it is not a regular directory',
      );
      expect(readFileSync(distPath, 'utf8')).toBe('not a directory');
    });
  });

  it('refuses to replace dist when it contains a symbolic link', () => {
    withFixture((repositoryRoot) => {
      const linkedFile = join(repositoryRoot, 'linked-file');
      writeFileSync(linkedFile, 'outside dist');
      mkdirSync(join(repositoryRoot, 'dist'));
      symlinkSync(linkedFile, join(repositoryRoot, 'dist/linked-file'));

      expect(() => writeCommittedBundle(repositoryRoot, compiler({ 'index.js': 'bundle' }))).toThrow(
        'Unexpected symbolic link in build output: dist/linked-file',
      );
      expect(readFileSync(linkedFile, 'utf8')).toBe('outside dist');
    });
  });
});
