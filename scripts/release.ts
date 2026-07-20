import { fileURLToPath } from 'node:url';

import { defaultRuntime, type ReleaseRuntime } from './release/command.js';
import { parseReleaseArgs, usage } from './release/cli.js';
import { createReleaseServices, runRelease } from './release/orchestrator.js';

export interface ReleaseCliOptions {
  argv: readonly string[];
  env?: NodeJS.ProcessEnv;
  runtime?: Partial<ReleaseRuntime>;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
}

export function runReleaseCli({ argv, env, runtime, stdout, stderr }: ReleaseCliOptions): number {
  const args = argv.slice(2);

  if (args[0] === '-h' || args[0] === '--help') {
    stdout.log(usage);
    return 0;
  }

  try {
    const parsedArgs = parseReleaseArgs(args);
    const releaseRuntime = { ...defaultRuntime(stdout), ...runtime, env: env ?? runtime?.env ?? process.env };
    runRelease(parsedArgs, createReleaseServices(releaseRuntime));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.error(message === usage ? usage : `error: ${message}`);
    return message === usage || message === 'expected version input like 1.2.3' ? 2 : 1;
  }
}

/* c8 ignore next 3 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runReleaseCli({ argv: process.argv, stdout: console, stderr: console }));
}
