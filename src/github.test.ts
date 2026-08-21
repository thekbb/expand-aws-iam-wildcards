import { describe, expect, it, vi } from 'vitest';

import {
  listPullRequestFiles,
  listActionReviewComments,
  syncReviewComments,
} from './github.js';
import { CURRENT_COMMENT_MARKER } from './comment-identity.js';
import type { PullRequestFile, PullRequestReviewComment, ReviewComment } from './types.js';

describe('listPullRequestFiles', () => {
  it('paginates pull request files with a page size of 100', async () => {
    const files: PullRequestFile[] = [
      { filename: 'policy-1.tf', patch: '@@ -0,0 +1 @@\n+"s3:Get*"' },
      { filename: 'policy-2.tf', patch: '@@ -0,0 +1 @@\n+"ec2:Describe*"' },
    ];
    const listFiles = {};
    const paginate = vi.fn().mockResolvedValue(files);
    const request = vi.fn();
    const octokit = {
      paginate,
      request,
      rest: {
        pulls: {
          listFiles,
        },
      },
    };

    const result = await listPullRequestFiles(octokit, 'thekbb', 'expand-aws-iam-wildcards', 42);

    expect(result).toEqual(files);
    expect(paginate).toHaveBeenCalledWith(listFiles, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      per_page: 100,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('recovers omitted file patches from the full pull request diff', async () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf' },
      { filename: 'complete.tf', patch: '@@ -1 +1 @@\n+"s3:Get*"' },
    ];
    const listFiles = {};
    const request = vi.fn().mockResolvedValue({
      data: `diff --git a/policy.tf b/policy.tf
--- a/policy.tf
+++ b/policy.tf
@@ -1 +1 @@
-"s3:GetObject"
+"s3:Get*"`,
    });
    const octokit = {
      paginate: vi.fn().mockResolvedValue(files),
      request,
      rest: { pulls: { listFiles } },
    };

    const result = await listPullRequestFiles(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    expect(result[0]?.patch).toBe('@@ -1 +1 @@\n-"s3:GetObject"\n+"s3:Get*"');
    expect(result[1]).toBe(files[1]);
    expect(request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: 'thekbb',
        repo: 'expand-aws-iam-wildcards',
        pull_number: 42,
        headers: { accept: 'application/vnd.github.diff' },
      },
    );
  });

  it('keeps omitted patches explicit when full-diff retrieval fails', async () => {
    const files: PullRequestFile[] = [{ filename: 'policy.tf' }];
    const octokit = {
      paginate: vi.fn().mockResolvedValue(files),
      request: vi.fn().mockRejectedValue(new Error('Resource not accessible by integration')),
      rest: { pulls: { listFiles: {} } },
    };

    await expect(listPullRequestFiles(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    )).resolves.toEqual(files);
  });

  it('ignores an unexpected non-diff fallback response', async () => {
    const files: PullRequestFile[] = [{ filename: 'policy.tf' }];
    const octokit = {
      paginate: vi.fn().mockResolvedValue(files),
      request: vi.fn().mockResolvedValue({ data: { message: 'unexpected response' } }),
      rest: { pulls: { listFiles: {} } },
    };

    await expect(listPullRequestFiles(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    )).resolves.toEqual(files);
  });
});

describe('listActionReviewComments', () => {
  const currentBody = `**IAM Wildcard Expansion**\n\n\`s3:Get*\` expands to 5 action(s):\n\nresults\n\n${CURRENT_COMMENT_MARKER}`;
  const legacyBody = '**IAM Wildcard Expansion**\n\n`s3:Get*` expands to 5 action(s):\n\nresults';

  it('does not resolve token identity when no comment has a recognized shape', async () => {
    const getAuthenticated = vi.fn();
    const graphql = vi.fn();
    const octokit = {
      paginate: vi.fn().mockResolvedValue([{
        id: 1,
        body: '**IAM Wildcard Expansion**\n\nA human-readable heading is not ownership.',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      }]),
      graphql,
      rest: {
        pulls: { listReviewComments: {} },
        users: { getAuthenticated },
      },
    };

    await expect(listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    )).resolves.toEqual([]);
    expect(getAuthenticated).not.toHaveBeenCalled();
    expect(graphql).not.toHaveBeenCalled();
  });

  it('returns only safely shaped comments from the configured GitHub Actions identity', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      {
        id: 1,
        body: currentBody,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 2,
        body: legacyBody,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 3,
        body: currentBody,
        user: { login: 'reviewer', type: 'User' },
      },
      {
        id: 4,
        body: currentBody,
        user: { login: 'unrelated[bot]', type: 'Bot' },
      },
      {
        id: 5,
        body: currentBody,
        user: { login: 'iam-reviewer[bot]', type: 'Bot' },
      },
      {
        id: 6,
        body: '**IAM Wildcard Expansion**\n\nA human-readable heading is not ownership.',
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 7,
        body: `${legacyBody}\n\n<!-- expand-aws-iam-wildcards:review-comment:v2 -->`,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 8,
        body: currentBody,
        user: { login: null, type: 'Bot' },
      },
    ];
    const listReviewComments = {};
    const paginate = vi.fn().mockResolvedValue(reviewComments);
    const getAuthenticated = vi.fn().mockRejectedValue(new Error('not a user token'));
    const graphql = vi.fn().mockResolvedValue({ viewer: { login: 'github-actions' } });
    const octokit = {
      paginate,
      graphql,
      rest: {
        pulls: {
          listReviewComments,
        },
        users: {
          getAuthenticated,
        },
      },
    };

    const result = await listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    expect(result).toEqual([reviewComments[0], reviewComments[1]]);
    expect(getAuthenticated).toHaveBeenCalledOnce();
    expect(graphql).toHaveBeenCalledWith(
      'query ExpandAwsIamWildcardsViewer { viewer { login } }',
    );
    expect(paginate).toHaveBeenCalledWith(listReviewComments, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      per_page: 100,
    });
  });

  it('marks action comments that have replies', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      {
        id: 1,
        body: currentBody,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        path: 'policy.tf',
        line: 10,
      },
      { id: 2, body: 'human reply', in_reply_to_id: 1, path: 'policy.tf', line: 10 },
      {
        id: 3,
        body: legacyBody,
        user: { login: 'github-actions[bot]', type: 'Bot' },
        path: 'policy.tf',
        line: 30,
      },
    ];
    const listReviewComments = {};
    const paginate = vi.fn().mockResolvedValue(reviewComments);
    const octokit = {
      paginate,
      graphql: vi.fn().mockResolvedValue({ viewer: { login: 'github-actions[bot]' } }),
      rest: {
        pulls: {
          listReviewComments,
        },
      },
    };

    const result = await listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    expect(result).toEqual([
      { ...reviewComments[0], hasReplies: true },
      reviewComments[2],
    ]);
  });

  it('accepts comments from the configured GitHub App bot', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      { id: 1, body: currentBody, user: { login: 'iam-reviewer[bot]', type: 'Bot' } },
      { id: 2, body: currentBody, user: { login: 'other-app[bot]', type: 'Bot' } },
    ];
    const octokit = {
      paginate: vi.fn().mockResolvedValue(reviewComments),
      graphql: vi.fn().mockResolvedValue({ viewer: { login: 'iam-reviewer' } }),
      rest: {
        pulls: { listReviewComments: {} },
        users: { getAuthenticated: vi.fn().mockRejectedValue(new Error('not a user token')) },
      },
    };

    const result = await listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    expect(result).toEqual([reviewComments[0]]);
  });

  it('accepts only comments authored by the authenticated PAT user', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      { id: 1, body: currentBody, user: { login: 'TheKBB', type: 'User' } },
      { id: 2, body: legacyBody, user: { login: 'thekbb', type: 'User' } },
      { id: 3, body: currentBody, user: { login: 'someone-else', type: 'User' } },
    ];
    const getAuthenticated = vi.fn().mockResolvedValue({ data: { login: 'thekbb' } });
    const octokit = {
      paginate: vi.fn().mockResolvedValue(reviewComments),
      graphql: vi.fn().mockRejectedValue(new Error('not available')),
      rest: {
        pulls: { listReviewComments: {} },
        users: { getAuthenticated },
      },
    };

    const result = await listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    expect(result).toEqual([reviewComments[0], reviewComments[1]]);
    expect(getAuthenticated).toHaveBeenCalledOnce();
  });

  it('leaves user-authored comments unmanaged when PAT identity cannot be resolved', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      { id: 1, body: currentBody, user: { login: 'thekbb', type: 'User' } },
    ];
    const octokit = {
      paginate: vi.fn().mockResolvedValue(reviewComments),
      rest: {
        pulls: { listReviewComments: {} },
        users: { getAuthenticated: vi.fn().mockRejectedValue(new Error('not available')) },
      },
    };

    await expect(listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    )).resolves.toEqual([]);
  });

  it('removes only owned duplicates and leaves an unrelated matching comment untouched', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      {
        id: 1,
        body: currentBody,
        path: 'policy.tf',
        line: 10,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 2,
        body: currentBody,
        path: 'policy.tf',
        line: 10,
        user: { login: 'github-actions[bot]', type: 'Bot' },
      },
      {
        id: 3,
        body: currentBody,
        path: 'policy.tf',
        line: 10,
        user: { login: 'reviewer', type: 'User' },
      },
    ];
    const deleteReviewComment = vi.fn().mockResolvedValue({});
    const octokit = {
      paginate: vi.fn().mockResolvedValue(reviewComments),
      graphql: vi.fn().mockResolvedValue({ viewer: { login: 'github-actions' } }),
      rest: {
        pulls: {
          listReviewComments: {},
          createReview: vi.fn().mockResolvedValue({}),
          updateReviewComment: vi.fn().mockResolvedValue({}),
          deleteReviewComment,
        },
      },
    };
    const existingComments = await listActionReviewComments(
      octokit,
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
    );

    const result = await syncReviewComments(octokit, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 42,
      commitSha: 'abc123',
      comments: [{ path: 'policy.tf', line: 10, body: currentBody }],
      existingComments,
    });

    expect(result.unchangedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 2,
    });
    expect(deleteReviewComment).not.toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 3 }),
    );
  });
});

describe('syncReviewComments', () => {
  const baseParams = {
    owner: 'thekbb',
    repo: 'expand-aws-iam-wildcards',
    pullNumber: 42,
    commitSha: 'abc123',
  };

  function makeOctokit() {
    return {
      rest: {
        pulls: {
          createReview: vi.fn().mockResolvedValue({}),
          updateReviewComment: vi.fn().mockResolvedValue({}),
          deleteReviewComment: vi.fn().mockResolvedValue({}),
        },
      },
    };
  }

  it('leaves matching comments alone', async () => {
    const existingComments: PullRequestReviewComment[] = [
      { id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nsame body' },
    ];
    const comments: ReviewComment[] = [
      { path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nsame body' },
    ];
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments,
      existingComments,
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 1,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.updateReviewComment).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('updates an existing comment in place when only the body changed', async () => {
    const existingComments: PullRequestReviewComment[] = [
      { id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nold body' },
    ];
    const comments: ReviewComment[] = [
      { path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' },
    ];
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments,
      existingComments,
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
      body: '**IAM Wildcard Expansion**\n\nnew body',
    });
    expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('migrates an owned legacy comment to the machine marker in place', async () => {
    const existingBody = '**IAM Wildcard Expansion**\n\n`s3:Get*` expands to 5 action(s):\n\nold results';
    const body = `${existingBody}\n\n${CURRENT_COMMENT_MARKER}`;
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [{ path: 'policy.tf', line: 10, body }],
      existingComments: [{ id: 1001, path: 'policy.tf', line: 10, body: existingBody }],
    });

    expect(result.updatedCount).toBe(1);
    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
      body,
    });
    expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('creates new comments before deleting stale comments', async () => {
    const comments: ReviewComment[] = [
      { path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' },
    ];
    const existingComments: PullRequestReviewComment[] = [
      { id: 1001, path: 'policy.tf', line: 20, body: '**IAM Wildcard Expansion**\n\nstale body' },
    ];
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments,
      existingComments,
    });

    expect(result).toEqual({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      commit_id: 'abc123',
      event: 'COMMENT',
      comments,
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenCalledBefore(
      octokit.rest.pulls.deleteReviewComment,
    );
  });

  it('does not delete existing comments when creating new comments fails', async () => {
    const octokit = makeOctokit();
    octokit.rest.pulls.createReview.mockRejectedValue(new Error('review failed'));

    await expect(syncReviewComments(octokit, {
      ...baseParams,
      comments: [{ path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' }],
      existingComments: [{ id: 1001, path: 'policy.tf', line: 20, body: '**IAM Wildcard Expansion**\n\nstale body' }],
    })).rejects.toThrow('review failed');

    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('deletes stale comments when there are no new comments to post', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [],
      existingComments: [{ id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nstale body' }],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.updateReviewComment).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
  });

  it('updates known comments but preserves stale comments after incomplete analysis', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [{
        path: 'analyzed.tf',
        line: 10,
        body: '**IAM Wildcard Expansion**\n\nnew body',
      }],
      existingComments: [
        {
          id: 1001,
          path: 'analyzed.tf',
          line: 10,
          body: '**IAM Wildcard Expansion**\n\nold body',
        },
        {
          id: 1002,
          path: 'missing.tf',
          line: 20,
          body: '**IAM Wildcard Expansion**\n\nstale body',
        },
      ],
      deleteStaleComments: false,
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 1,
    });
    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
      body: '**IAM Wildcard Expansion**\n\nnew body',
    });
    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('deletes duplicate comments when one exact match is kept', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [{ path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nsame body' }],
      existingComments: [
        { id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nsame body' },
        { id: 1002, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nsame body' },
      ],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 1,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.updateReviewComment).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1002,
    });
  });

  it('updates an existing comment when the current line anchor is still available', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [{ path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' }],
      existingComments: [{ id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nold body' }],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
      body: '**IAM Wildcard Expansion**\n\nnew body',
    });
  });

  it('recreates outdated comments instead of updating them in place', async () => {
    const octokit = makeOctokit();
    const comments: ReviewComment[] = [
      { path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' },
    ];

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments,
      existingComments: [
        {
          id: 1001,
          path: 'policy.tf',
          position: null,
          line: 10,
          original_line: 10,
          body: '**IAM Wildcard Expansion**\n\nold body',
        },
      ],
    });

    expect(result).toEqual({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.updateReviewComment).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      commit_id: 'abc123',
      event: 'COMMENT',
      comments,
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
  });

  it('treats comments without a usable anchor as stale', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [],
      existingComments: [{ id: 1001, body: '**IAM Wildcard Expansion**\n\nstale body' }],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
  });

  it('treats comments with a path but no line information as stale', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [],
      existingComments: [{ id: 1001, path: 'policy.tf', body: '**IAM Wildcard Expansion**\n\nstale body' }],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
  });

  it('continues deleting stale comments when one delete fails', async () => {
    const octokit = makeOctokit();
    octokit.rest.pulls.deleteReviewComment
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({});

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [],
      existingComments: [
        { id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nstale body 1' },
        { id: 1002, path: 'policy.tf', line: 20, body: '**IAM Wildcard Expansion**\n\nstale body 2' },
        { id: 1003, path: 'policy.tf', line: 30, body: '**IAM Wildcard Expansion**\n\nstale body 3' },
      ],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 2,
      failedDeleteCount: 1,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledTimes(3);
  });

  it('preserves stale comments with replies while creating a new current comment', async () => {
    const octokit = makeOctokit();
    const comments: ReviewComment[] = [
      { path: 'policy.tf', line: 12, body: '**IAM Wildcard Expansion**\n\nnew body' },
    ];

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments,
      existingComments: [
        {
          id: 1001,
          path: 'policy.tf',
          position: null,
          line: 10,
          original_line: 10,
          hasReplies: true,
          body: '**IAM Wildcard Expansion**\n\nold body',
        },
      ],
    });

    expect(result).toEqual({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 1,
    });
    expect(octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      commit_id: 'abc123',
      event: 'COMMENT',
      comments,
    });
    expect(octokit.rest.pulls.deleteReviewComment).not.toHaveBeenCalled();
  });

  it('prefers updating the existing comment that already has replies', async () => {
    const octokit = makeOctokit();

    const result = await syncReviewComments(octokit, {
      ...baseParams,
      comments: [{ path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nnew body' }],
      existingComments: [
        { id: 1001, path: 'policy.tf', line: 10, body: '**IAM Wildcard Expansion**\n\nold body' },
        { id: 1002, path: 'policy.tf', line: 10, hasReplies: true, body: '**IAM Wildcard Expansion**\n\nolder body' },
      ],
    });

    expect(result).toEqual({
      createdCount: 0,
      updatedCount: 1,
      unchangedCount: 0,
      deletedCount: 1,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    expect(octokit.rest.pulls.updateReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1002,
      body: '**IAM Wildcard Expansion**\n\nnew body',
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
  });
});
