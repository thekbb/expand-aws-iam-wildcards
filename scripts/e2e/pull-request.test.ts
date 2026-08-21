import { describe, expect, it } from 'vitest';

import {
  ACTION_COMMENT_MARKER,
  assertRuntimeResult,
  getActionParentComments,
  getNextLink,
  parseRepository,
} from './pull-request.js';

describe('pull request E2E helpers', () => {
  it('parses one owner and repository name', () => {
    expect(parseRepository('thekbb/expand-aws-iam-wildcards')).toEqual([
      'thekbb',
      'expand-aws-iam-wildcards',
    ]);
    expect(() => parseRepository('missing-repository')).toThrow(
      'Expected E2E_REPOSITORY as owner/repo',
    );
    expect(() => parseRepository('owner/repo/extra')).toThrow(
      'Expected E2E_REPOSITORY as owner/repo',
    );
    expect(() => parseRepository('owner/bad repo')).toThrow(
      'Expected E2E_REPOSITORY as owner/repo',
    );
  });

  it('finds the next pagination link', () => {
    expect(getNextLink(null)).toBeNull();
    expect(getNextLink(
      '<https://api.github.com/page/1>; rel="prev", '
        + '<https://api.github.com/page/3>; rel="next"',
    )).toBe('https://api.github.com/page/3');
    expect(getNextLink('<https://api.github.com/page/1>; rel="prev"')).toBeNull();
  });

  it('selects only marked parent comments on the fixture path', () => {
    const comments = [
      {
        id: 1,
        path: 'fixture.tf',
        body: `body\n${ACTION_COMMENT_MARKER}`,
        user: { type: 'Bot' },
      },
      {
        id: 2,
        path: 'fixture.tf',
        body: ACTION_COMMENT_MARKER,
        in_reply_to_id: 1,
        user: { type: 'Bot' },
      },
      { id: 3, path: 'other.tf', body: ACTION_COMMENT_MARKER, user: { type: 'Bot' } },
      {
        id: 4,
        path: 'fixture.tf',
        body: `prefix ${ACTION_COMMENT_MARKER}`,
        user: { type: 'Bot' },
      },
      { id: 5, path: 'fixture.tf', body: ACTION_COMMENT_MARKER, user: { type: 'User' } },
    ];

    expect(getActionParentComments(comments, 'fixture.tf').map((comment) => comment.id)).toEqual([
      1,
    ]);
  });

  it('requires successful runtime output', () => {
    expect(() => assertRuntimeResult({
      status: 0,
      stderr: '',
      stdout: 'created\nupdated',
    }, ['created', 'updated'])).not.toThrow();
    expect(() => assertRuntimeResult({
      status: 1,
      stderr: 'failed',
      stdout: '',
    }, [])).toThrow('E2E action failed with exit status 1: failed');
    expect(() => assertRuntimeResult({
      status: 0,
      stderr: '',
      stdout: 'created',
    }, ['updated'])).toThrow('E2E action output omitted: updated');
    const error = new Error('spawn failed');
    expect(() => assertRuntimeResult({
      error,
      status: null,
      stderr: '',
      stdout: '',
    }, [])).toThrow(error);
  });
});
