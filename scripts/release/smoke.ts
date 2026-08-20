import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import { load } from 'js-yaml';

export const EXPECTED_SKIP_MESSAGE = 'This action only runs on pull requests. Skipping.';

interface SmokeResult {
  readonly error?: Error;
  readonly status: number | null;
  readonly stderr: string;
  readonly stdout: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveActionRuntime(actionYaml: string, outputDirectory: string): string {
  const metadata: unknown = load(actionYaml);
  if (!isRecord(metadata) || !isRecord(metadata.runs) || typeof metadata.runs.main !== 'string') {
    throw new Error('action.yml runs.main must be a string');
  }

  const relativeRuntime = posix.relative('dist', metadata.runs.main);
  if (relativeRuntime === '' || relativeRuntime.startsWith('../') || posix.isAbsolute(relativeRuntime)) {
    throw new Error(`action.yml runtime must be a file under dist/: ${metadata.runs.main}`);
  }
  return resolve(outputDirectory, relativeRuntime);
}

export function assertSmokeResult(result: SmokeResult): void {
  if (result.error !== undefined) throw result.error;

  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  if (result.status !== 0) {
    throw new Error(`Compiled action smoke test failed with exit status ${result.status ?? 1}: ${output}`);
  }
  if (!result.stdout.includes(EXPECTED_SKIP_MESSAGE)) {
    throw new Error(`Compiled action did not log the expected skip message. Output: ${output}`);
  }
}

export function smokeTestAction(actionYaml: string, outputDirectory: string): void {
  const eventDirectory = mkdtempSync(join(tmpdir(), 'expand-aws-iam-wildcards-smoke-'));
  const eventPath = join(eventDirectory, 'event.json');

  try {
    writeFileSync(eventPath, '{}\n');
    const result = spawnSync(process.execPath, [resolveActionRuntime(actionYaml, outputDirectory)], {
      encoding: 'utf8',
      env: {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'thekbb/expand-aws-iam-wildcards',
      },
      timeout: 15_000,
    });
    assertSmokeResult({
      status: result.status,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
      ...(result.error === undefined ? {} : { error: result.error }),
    });
  } finally {
    rmSync(eventDirectory, { force: true, recursive: true });
  }
}
