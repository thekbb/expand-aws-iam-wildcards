/**
 * Generates static IAM action and service-doc metadata at build time.
 * Run with: npm run generate-iam-data
 */
import { resolve } from 'node:path';

import { generateIamData } from './iam-data/generator.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

try {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output-dir')) {
    throw new Error('usage: tsx scripts/generate-iam-data.ts [--output-dir <directory>]');
  }

  const outputDirectory = args[1] === undefined
    ? resolve(repositoryRoot, 'src')
    : resolve(repositoryRoot, args[1]);
  const result = generateIamData({
    dataDirectory: resolve(repositoryRoot, 'node_modules/@cloud-copilot/iam-data/data'),
    outputDirectory,
    repositoryRoot,
  });

  console.log(`Generated ${result.actionCount} IAM actions and ${result.serviceCount} service doc slugs`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
