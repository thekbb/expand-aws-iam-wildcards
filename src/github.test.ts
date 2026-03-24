import { describe, expect, it, vi } from 'vitest';

import {
  listPullRequestFiles,
  listActionReviewComments,
  syncReviewComments,
} from './github.js';
import type { PullRequestFile, PullRequestReviewComment, ReviewComment } from './types.js';

describe('listPullRequestFiles', () => {
  it('paginates pull request files with a page size of 100', async () => {
    const files: PullRequestFile[] = [
      { filename: 'policy-1.tf', patch: '+ "s3:Get*"' },
      { filename: 'policy-2.tf', patch: '+ "ec2:Describe*"' },
    ];
    const listFiles = {};
    const paginate = vi.fn().mockResolvedValue(files);
    const octokit = {
      paginate,
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
  });
});

describe('listActionReviewComments', () => {
  it('returns only comments that include the action marker', async () => {
    const reviewComments: PullRequestReviewComment[] = [
      { id: 1, body: '**IAM Wildcard Expansion**\n\ncomment body', path: 'policy.tf', line: 10 },
      { id: 2, body: 'other bot comment', path: 'policy.tf', line: 20 },
      { id: 3, body: '**IAM Wildcard Expansion**\n\nanother comment body', path: 'policy.tf', line: 30 },
    ];
    const listReviewComments = {};
    const paginate = vi.fn().mockResolvedValue(reviewComments);
    const octokit = {
      paginate,
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
      '**IAM Wildcard Expansion**',
    );

    expect(result).toEqual([reviewComments[0], reviewComments[2]]);
    expect(paginate).toHaveBeenCalledWith(listReviewComments, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pull_number: 42,
      per_page: 100,
    });
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
    expect(octokit.rest.pulls.createReview.mock.invocationCallOrder[0]).toBeLessThan(
      octokit.rest.pulls.deleteReviewComment.mock.invocationCallOrder[0],
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
    });
    expect(octokit.rest.pulls.createReview).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.updateReviewComment).not.toHaveBeenCalled();
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      comment_id: 1001,
    });
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
    });
    expect(octokit.rest.pulls.deleteReviewComment).toHaveBeenCalledTimes(3);
  });
});
