import { fileURLToPath } from 'node:url';

import { createCommandRunner, type CommandRunner } from './release/command.js';
import { selectIamDataVersion } from './release/iam-data.js';

const USAGE = 'usage: tsx scripts/select-iam-data.ts [exact-version]';

export interface SelectIamDataCliOptions {
  readonly args: readonly string[];
  readonly repositoryRoot: string;
  readonly run: CommandRunner;
  readonly stdout: Pick<typeof console, 'log'>;
  readonly stderr: Pick<typeof console, 'error'>;
}

export function runSelectIamDataCli(options: SelectIamDataCliOptions): number {
  try {
    if (options.args.length > 1) throw new Error(USAGE);
    const selection = selectIamDataVersion(
      options.repositoryRoot,
      options.args[0],
      options.run,
    );
    const status = selection.changed ? 'Selected' : 'Kept';
    options.stdout.log(
      `${status} @cloud-copilot/iam-data ${selection.selectedVersion} ` +
      `(previously ${selection.previousVersion}).`,
    );
    return 0;
  } catch (error) {
    options.stderr.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/* c8 ignore next 8 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runSelectIamDataCli({
    args: process.argv.slice(2),
    repositoryRoot: process.cwd(),
    run: createCommandRunner(),
    stdout: console,
    stderr: console,
  }));
}
