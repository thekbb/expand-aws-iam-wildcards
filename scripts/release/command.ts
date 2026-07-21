import { spawnSync } from 'node:child_process';
import { readSync } from 'node:fs';

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { stdio?: 'inherit' },
) => CommandResult;

export interface ReleaseRuntime {
  env: NodeJS.ProcessEnv;
  promptEnter: (message: string) => void;
  run: CommandRunner;
  sleep: (milliseconds: number) => void;
  stdinIsTTY: boolean;
  stdout: Pick<typeof console, 'log'>;
}

export function createCommandRunner(): CommandRunner {
  return (command, args, options = {}) => {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: options.stdio === 'inherit' ? 'inherit' : 'pipe',
    });

    if (result.error !== undefined) {
      throw result.error;
    }

    return {
      status: result.status ?? 1,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  };
}

export function defaultRuntime(stdout: Pick<typeof console, 'log'>): ReleaseRuntime {
  return {
    env: process.env,
    promptEnter: createPromptEnter(),
    run: createCommandRunner(),
    sleep: (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
    stdinIsTTY: process.stdin.isTTY,
    stdout,
  };
}

export function createPromptEnter({
  fd = 0,
  write = (message: string) => process.stdout.write(message),
}: {
  fd?: number;
  write?: (message: string) => void;
} = {}): (message: string) => void {
  return (message) => {
    write(message);
    readUntilEnter(fd);
  };
}

export function readUntilEnter(fd: number): void {
  const buffer = Buffer.alloc(1);

  while (true) {
    const bytesRead = readSync(fd, buffer, 0, 1, null);
    if (bytesRead === 0 || buffer[0] === 10 || buffer[0] === 13) {
      return;
    }
  }
}

export function runChecked(
  runtime: ReleaseRuntime,
  command: string,
  args: readonly string[],
  options?: { stdio?: 'inherit' },
): CommandResult {
  const result = runtime.run(command, args, options);
  if (result.status !== 0) {
    const detail = result.stderr.trim() === '' ? `exit status ${result.status}` : result.stderr.trim();
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }

  return result;
}

export function runText(runtime: ReleaseRuntime, command: string, args: readonly string[]): string {
  return runChecked(runtime, command, args).stdout.trim();
}

export function requireCommand(runtime: ReleaseRuntime, command: string): void {
  if (runtime.run('which', [command]).status !== 0) {
    throw new Error(`required command not found: ${command}`);
  }
}
