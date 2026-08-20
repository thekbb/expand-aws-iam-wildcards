import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import {
  checkCommittedBundle,
  type BundleCompiler,
  writeCommittedBundle,
} from './release/build.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const nccCli = resolve(repositoryRoot, 'node_modules/@vercel/ncc/dist/ncc/cli.js');

const compile: BundleCompiler = (outputDirectory) => {
  const result = spawnSync(process.execPath, [
    nccCli,
    'build',
    'src/index.ts',
    '-o',
    outputDirectory,
    '--no-source-map-register',
    '--license',
    'licenses.txt',
  ], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });

  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`ncc failed with exit status ${result.status ?? 1}`);
};

try {
  const [operation, ...unexpectedArguments] = process.argv.slice(2);
  if (unexpectedArguments.length > 0 || (operation !== undefined && operation !== '--check')) {
    throw new Error('usage: tsx scripts/build.ts [--check]');
  }

  if (operation === '--check') {
    checkCommittedBundle(repositoryRoot, compile);
    console.log('Repeated builds match the committed dist/index.js.');
  } else {
    writeCommittedBundle(repositoryRoot, compile);
    console.log('Built dist/index.js.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
