import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateIamData, validateGeneratorOutputDirectory } from './generator.js';

function withFixture<T>(useFixture: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'iam-generator-test-'));
  try {
    return useFixture(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function createDataFixture(directory: string): string {
  const dataDirectory = join(directory, 'data');
  const actionsDirectory = join(dataDirectory, 'actions');
  mkdirSync(actionsDirectory, { recursive: true });
  writeFileSync(join(actionsDirectory, 'zeta.json'), JSON.stringify({
    second: { name: 'Beta' },
    first: { name: 'Alpha' },
  }));
  writeFileSync(join(actionsDirectory, 'sso.json'), JSON.stringify({
    create: { name: 'CreateApplication' },
  }));
  writeFileSync(join(actionsDirectory, 'README.txt'), 'ignored');
  writeFileSync(join(dataDirectory, 'serviceNames.json'), JSON.stringify({
    sso: 'AWS IAM Identity Center',
    zeta: 'AWS Zeta-Service!',
  }));
  return dataDirectory;
}

function generatedFiles(directory: string): [string, string] {
  return [
    readFileSync(join(directory, 'iam-actions.ts'), 'utf8'),
    readFileSync(join(directory, 'service-doc-slugs.ts'), 'utf8'),
  ];
}

describe('generateIamData', () => {
  it('writes sorted actions and stable documentation slugs to the requested directory', () => {
    withFixture((repositoryRoot) => {
      const dataDirectory = createDataFixture(repositoryRoot);
      const outputDirectory = join(repositoryRoot, 'generated');

      expect(generateIamData({ dataDirectory, outputDirectory, repositoryRoot })).toEqual({
        actionCount: 3,
        serviceCount: 2,
      });
      const [actions, slugs] = generatedFiles(outputDirectory);
      expect(actions).toContain('[\n  "sso:CreateApplication",\n  "zeta:Alpha",\n  "zeta:Beta"\n]');
      expect(slugs).toContain('"sso": "awsiamidentitycentersuccessortoawssinglesignon"');
      expect(slugs).toContain('"zeta": "awszetaservice"');
    });
  });

  it('generates fixture output byte-for-byte identically twice', () => {
    withFixture((repositoryRoot) => {
      const dataDirectory = createDataFixture(repositoryRoot);
      const firstOutput = join(repositoryRoot, 'first');
      const secondOutput = join(repositoryRoot, 'second');

      generateIamData({ dataDirectory, outputDirectory: firstOutput, repositoryRoot });
      generateIamData({ dataDirectory, outputDirectory: secondOutput, repositoryRoot });

      expect(generatedFiles(firstOutput)).toEqual(generatedFiles(secondOutput));
    });
  });

  it('generates the locked IAM package byte-for-byte identically twice', () => {
    withFixture((temporaryDirectory) => {
      const repositoryRoot = resolve(import.meta.dirname, '../..');
      const dataDirectory = join(repositoryRoot, 'node_modules/@cloud-copilot/iam-data/data');
      const firstOutput = join(temporaryDirectory, 'first');
      const secondOutput = join(temporaryDirectory, 'second');

      const firstResult = generateIamData({ dataDirectory, outputDirectory: firstOutput, repositoryRoot });
      const secondResult = generateIamData({ dataDirectory, outputDirectory: secondOutput, repositoryRoot });

      expect(firstResult.actionCount).toBeGreaterThan(0);
      expect(firstResult.serviceCount).toBeGreaterThan(0);
      expect(secondResult).toEqual(firstResult);
      expect(generatedFiles(secondOutput)).toEqual(generatedFiles(firstOutput));
    });
  });

  it('fails when a service name is missing', () => {
    withFixture((repositoryRoot) => {
      const dataDirectory = createDataFixture(repositoryRoot);
      writeFileSync(join(dataDirectory, 'serviceNames.json'), JSON.stringify({ sso: 'Identity Center' }));

      expect(() => generateIamData({
        dataDirectory,
        outputDirectory: join(repositoryRoot, 'generated'),
        repositoryRoot,
      })).toThrow('Missing service name metadata for IAM service prefix: zeta');
    });
  });

  it('refuses generated output files that are symbolic links', () => {
    withFixture((repositoryRoot) => {
      const dataDirectory = createDataFixture(repositoryRoot);
      const outputDirectory = join(repositoryRoot, 'generated');
      const linkedFile = join(repositoryRoot, 'linked-file');
      mkdirSync(outputDirectory);
      writeFileSync(linkedFile, 'do not replace');
      symlinkSync(linkedFile, join(outputDirectory, 'iam-actions.ts'));

      expect(() => generateIamData({ dataDirectory, outputDirectory, repositoryRoot })).toThrow(
        `IAM data output file must be a regular file: ${join(outputDirectory, 'iam-actions.ts')}`,
      );
      expect(readFileSync(linkedFile, 'utf8')).toBe('do not replace');
      expect(() => readFileSync(join(outputDirectory, 'service-doc-slugs.ts'), 'utf8')).toThrow();
    });
  });

  it('refuses a directory at a generated output file path', () => {
    withFixture((repositoryRoot) => {
      const dataDirectory = createDataFixture(repositoryRoot);
      const outputDirectory = join(repositoryRoot, 'generated');
      const actionsOutputPath = join(outputDirectory, 'iam-actions.ts');
      mkdirSync(actionsOutputPath, { recursive: true });

      expect(() => generateIamData({ dataDirectory, outputDirectory, repositoryRoot })).toThrow(
        `IAM data output file must be a regular file: ${actionsOutputPath}`,
      );
      expect(() => readFileSync(join(outputDirectory, 'service-doc-slugs.ts'), 'utf8')).toThrow();
    });
  });
});

describe('validateGeneratorOutputDirectory', () => {
  it('allows repository and temporary descendants', () => {
    withFixture((temporaryDirectory) => {
      const repositoryRoot = resolve(import.meta.dirname, '../..');
      expect(validateGeneratorOutputDirectory(
        repositoryRoot,
        join(repositoryRoot, '.generated/iam-data'),
      )).toBe(join(repositoryRoot, '.generated/iam-data'));
      expect(validateGeneratorOutputDirectory(
        repositoryRoot,
        join(temporaryDirectory, 'iam-data'),
      )).toBe(join(temporaryDirectory, 'iam-data'));
    });
  });

  it('rejects broad or unrelated output paths', () => {
    const repositoryRoot = resolve(import.meta.dirname, '../..');
    expect(() => validateGeneratorOutputDirectory(repositoryRoot, repositoryRoot)).toThrow(
      'IAM data output must be inside the repository or temporary directory',
    );
    expect(() => validateGeneratorOutputDirectory(repositoryRoot, resolve(repositoryRoot, '..'))).toThrow(
      'IAM data output must be inside the repository or temporary directory',
    );
  });

  it('rejects files and symbolic links as output directories', () => {
    withFixture((temporaryDirectory) => {
      const repositoryRoot = resolve(import.meta.dirname, '../..');
      const filePath = join(temporaryDirectory, 'file');
      const realDirectory = join(temporaryDirectory, 'real-directory');
      const linkPath = join(temporaryDirectory, 'linked-directory');
      writeFileSync(filePath, 'file');
      mkdirSync(realDirectory);
      symlinkSync(realDirectory, linkPath);

      expect(() => validateGeneratorOutputDirectory(repositoryRoot, filePath)).toThrow(
        `IAM data output must be a regular directory: ${filePath}`,
      );
      expect(() => validateGeneratorOutputDirectory(repositoryRoot, linkPath)).toThrow(
        `IAM data output must be a regular directory: ${linkPath}`,
      );
    });
  });
});
