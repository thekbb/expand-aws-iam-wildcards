import { describe, expect, it } from 'vitest';

import {
  type CommandResult,
  type ReleaseRuntime,
  createCommandRunner,
  defaultRuntime,
  requireCommand,
  runChecked,
  runText,
} from './command.js';

function runtime(result: CommandResult): ReleaseRuntime {
  return {
    env: {},
    promptEnter: () => undefined,
    run: () => result,
    sleep: () => undefined,
    stdinIsTTY: false,
    stdout: console,
  };
}

describe('createCommandRunner', () => {
  it('captures stdout and status from a spawned command', () => {
    const run = createCommandRunner();

    expect(run(process.execPath, ['-e', 'process.stdout.write("ok")'])).toEqual({
      status: 0,
      stderr: '',
      stdout: 'ok',
    });
  });

  it('throws spawn errors for missing commands', () => {
    const run = createCommandRunner();

    expect(() => run('definitely-not-a-real-release-command', [])).toThrow('spawn');
  });
});

describe('defaultRuntime', () => {
  it('wires the process environment, command runner, and stdout', () => {
    const stdout = { log: () => undefined };
    const runtime = defaultRuntime(stdout);

    expect(runtime.env).toBe(process.env);
    expect(runtime.stdout).toBe(stdout);
    expect(runtime.run(process.execPath, ['-e', 'process.stdout.write("ok")']).stdout).toBe('ok');
    expect(typeof runtime.sleep).toBe('function');
    expect(runtime.stdinIsTTY).toBe(process.stdin.isTTY);
  });
});

describe('runChecked', () => {
  it('returns successful command results', () => {
    expect(runChecked(runtime({ status: 0, stderr: '', stdout: 'ok' }), 'cmd', ['arg']).stdout).toBe('ok');
  });

  it('uses stderr in failed command messages', () => {
    expect(() => runChecked(runtime({ status: 1, stderr: 'bad input\n', stdout: '' }), 'cmd', ['arg'])).toThrow(
      'cmd arg failed: bad input',
    );
  });

  it('falls back to status in failed command messages', () => {
    expect(() => runChecked(runtime({ status: 9, stderr: '', stdout: '' }), 'cmd', ['arg'])).toThrow(
      'cmd arg failed: exit status 9',
    );
  });
});

describe('runText', () => {
  it('trims command stdout', () => {
    expect(runText(runtime({ status: 0, stderr: '', stdout: '  value\n' }), 'cmd', ['arg'])).toBe('value');
  });
});

describe('requireCommand', () => {
  it('rejects missing commands', () => {
    expect(() => requireCommand(runtime({ status: 1, stderr: '', stdout: '' }), 'gh')).toThrow(
      'required command not found: gh',
    );
  });
});
