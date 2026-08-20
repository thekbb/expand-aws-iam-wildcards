import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertSmokeResult,
  EXPECTED_SKIP_MESSAGE,
  resolveActionRuntime,
  smokeTestAction,
} from './smoke.js';
import { withTemporaryBundle } from './build.js';

const actionYaml = `
runs:
  using: node24
  main: dist/index.js
`;

function withRuntime(
  source: string,
  useRuntime: (outputDirectory: string) => void,
): void {
  withTemporaryBundle((outputDirectory) => {
    writeFileSync(join(outputDirectory, 'index.js'), source);
  }, useRuntime);
}

describe('compiled action smoke test', () => {
  it('runs the declared action entry with a safe non-PR event', () => {
    const previousValue = process.env.EXPAND_IAM_SMOKE_PARENT_SECRET;
    process.env.EXPAND_IAM_SMOKE_PARENT_SECRET = 'must-not-reach-child';

    try {
      withRuntime(`
        const fs = require('node:fs');
        const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        if (process.env.GITHUB_EVENT_NAME !== 'push') process.exit(2);
        if (Object.keys(event).length !== 0) process.exit(3);
        if (process.env.EXPAND_IAM_SMOKE_PARENT_SECRET !== undefined) process.exit(4);
        process.stdout.write('${EXPECTED_SKIP_MESSAGE}');
      `, (outputDirectory) => {
        expect(() => smokeTestAction(actionYaml, outputDirectory)).not.toThrow();
      });
    } finally {
      if (previousValue === undefined) {
        delete process.env.EXPAND_IAM_SMOKE_PARENT_SECRET;
      } else {
        process.env.EXPAND_IAM_SMOKE_PARENT_SECRET = previousValue;
      }
    }
  });

  it('fails when the declared runtime is stale', () => {
    withRuntime(`process.stdout.write('${EXPECTED_SKIP_MESSAGE}');`, (outputDirectory) => {
      const staleAction = actionYaml.replace('dist/index.js', 'dist/missing.js');
      expect(() => smokeTestAction(staleAction, outputDirectory)).toThrow(
        'Compiled action smoke test failed with exit status 1',
      );
    });
  });

  it('fails when the bundle omits a runtime dependency', () => {
    withRuntime("require('definitely-not-a-real-runtime-dependency');", (outputDirectory) => {
      expect(() => smokeTestAction(actionYaml, outputDirectory)).toThrow(
        'Compiled action smoke test failed with exit status 1',
      );
    });
  });

  it('rejects runtime paths outside dist', () => {
    expect(() => resolveActionRuntime(
      actionYaml.replace('dist/index.js', '../index.js'),
      '/temporary/dist',
    )).toThrow('action.yml runtime must be a file under dist/: ../index.js');
    expect(() => resolveActionRuntime(
      actionYaml.replace('dist/index.js', 'dist'),
      '/temporary/dist',
    )).toThrow('action.yml runtime must be a file under dist/: dist');
  });

  it('rejects malformed action metadata', () => {
    expect(() => resolveActionRuntime('name: invalid', '/temporary/dist')).toThrow(
      'action.yml runs.main must be a string',
    );
  });

  it('reports subprocess and output failures', () => {
    const spawnError = new Error('spawn failed');
    expect(() => assertSmokeResult({
      error: spawnError,
      status: null,
      stderr: '',
      stdout: '',
    })).toThrow(spawnError);
    expect(() => assertSmokeResult({
      status: null,
      stderr: 'timed out',
      stdout: '',
    })).toThrow('Compiled action smoke test failed with exit status 1: timed out');
    expect(() => assertSmokeResult({
      status: 0,
      stderr: '',
      stdout: 'wrong output',
    })).toThrow('Compiled action did not log the expected skip message. Output: wrong output');
  });
});
