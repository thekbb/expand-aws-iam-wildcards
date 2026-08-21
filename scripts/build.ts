import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  checkCommittedBundle,
  type BundleCompiler,
  withTemporaryBundle,
  writeCommittedBundle,
} from './release/build.js';
import { smokeTestAction } from './release/smoke.js';
import { withGeneratedBuildWorkspace } from './release/workspace.js';

const repositoryRoot = resolve(import.meta.dirname, '..');
const nccCli = resolve(repositoryRoot, 'node_modules/@vercel/ncc/dist/ncc/cli.js');

const compile: BundleCompiler = (outputDirectory) => {
  withGeneratedBuildWorkspace(repositoryRoot, (workspace) => {
    const result = spawnSync(process.execPath, [
      nccCli,
      'build',
      workspace.entryPoint,
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
  });
};

try {
  const [operation, ...unexpectedArguments] = process.argv.slice(2);
  if (
    unexpectedArguments.length > 0 ||
    (operation !== undefined && operation !== '--check' && operation !== '--smoke')
  ) {
    throw new Error('usage: tsx scripts/build.ts [--check|--smoke]');
  }

  if (operation === '--check') {
    checkCommittedBundle(repositoryRoot, compile);
    console.log('Repeated builds match the committed dist/index.js.');
  } else if (operation === '--smoke') {
    const actionYaml = readFileSync(resolve(repositoryRoot, 'action.yml'), 'utf8');
    withTemporaryBundle(compile, (outputDirectory) => smokeTestAction(actionYaml, outputDirectory));
    console.log('Temporary dist/index.js passed the non-PR smoke test.');
  } else {
    writeCommittedBundle(repositoryRoot, compile);
    console.log('Built dist/index.js.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
