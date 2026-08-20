import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { validateDocsContract } from './docs-contract.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');
const errors = validateDocsContract({
  actionYaml: read('action.yml'),
  fileExists: (path) => existsSync(resolve(repositoryRoot, path)),
  packageJson: read('package.json'),
  readme: read('README.md'),
});

if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Documentation contract is current.');
}
