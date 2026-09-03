import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

interface ReleaseWorkflow {
  readonly jobs: {
    readonly publish: {
      readonly if?: string;
      readonly needs: string;
      readonly permissions: Readonly<Record<string, string>>;
    };
    readonly verify: {
      readonly permissions: Readonly<Record<string, string>>;
    };
  };
  readonly permissions: Readonly<Record<string, string>>;
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflowPath = resolve(repositoryRoot, '.github/workflows/verify-draft-release.yml');
const retiredPublishWorkflowPath = resolve(
  repositoryRoot,
  '.github/workflows/publish-verified-release.yml',
);

describe('release workflow', () => {
  it('publishes only after verification with separate least-privilege tokens', () => {
    const source = readFileSync(workflowPath, 'utf8');
    const workflow = load(source) as ReleaseWorkflow;

    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.verify.permissions).toEqual({
      attestations: 'write',
      contents: 'read',
      'id-token': 'write',
    });
    expect(workflow.jobs.publish.needs).toBe('verify');
    expect(workflow.jobs.publish.if).toBeUndefined();
    expect(workflow.jobs.publish.permissions).toEqual({
      attestations: 'read',
      contents: 'write',
    });

    expect(source).not.toContain('repository_dispatch');
    expect(source).not.toContain('IAM_UPDATE_PAT');
    expect(source).not.toContain('/actions/runs/');
    expect(existsSync(retiredPublishWorkflowPath)).toBe(false);
  });
});
