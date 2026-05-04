import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PullRequestFile, PullRequestReviewComment } from './types.js';

const coreMocks = vi.hoisted(() => ({
  getInput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));

const githubMocks = vi.hoisted(() => ({
  context: {
    payload: {
      pull_request: {
        number: 42,
        head: {
          sha: 'deadbeefcafebabe',
        },
      },
    },
    repo: {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
    },
  },
  getOctokit: vi.fn(),
}));

vi.mock('@actions/core', () => coreMocks);
vi.mock('@actions/github', () => githubMocks);

import { runAction } from './main.js';

describe('runAction integration', () => {
  const reviewComments: PullRequestReviewComment[] = [];
  const files: PullRequestFile[] = [];
  const listFilesRoute = {};
  const listReviewCommentsRoute = {};
  let nextCommentId = 1000;

  const createReview = vi.fn(async (parameters: {
    owner: string;
    repo: string;
    pull_number: number;
    commit_id: string;
    event: 'COMMENT';
    comments: { path: string; line: number; body: string }[];
  }) => {
    for (const comment of parameters.comments) {
      reviewComments.push({
        id: nextCommentId++,
        path: comment.path,
        line: comment.line,
        position: comment.line,
        body: comment.body,
      });
    }

    return {};
  });

  const updateReviewComment = vi.fn(async (parameters: {
    comment_id: number;
    body: string;
  }) => {
    const comment = reviewComments.find((entry) => entry.id === parameters.comment_id);
    if (!comment) {
      throw new Error(`Missing mocked review comment ${parameters.comment_id}`);
    }

    comment.body = parameters.body;
    return {};
  });

  const deleteReviewComment = vi.fn(async (parameters: {
    comment_id: number;
  }) => {
    const index = reviewComments.findIndex((entry) => entry.id === parameters.comment_id);
    if (index === -1) {
      throw new Error(`Missing mocked review comment ${parameters.comment_id}`);
    }

    reviewComments.splice(index, 1);
    return {};
  });

  const paginate = vi.fn(async (route: unknown) => {
    if (route === listFilesRoute) {
      return files;
    }

    if (route === listReviewCommentsRoute) {
      return reviewComments;
    }

    throw new Error('Unexpected paginate route');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    reviewComments.length = 0;
    files.length = 0;
    nextCommentId = 1000;

    files.push({
      filename: 'fixtures/e2e/smoke/policy.tf',
      patch: [
        '@@ -0,0 +1,5 @@',
        '+locals {',
        '+  smoke_policy_actions = [',
        '+    "s3:Get*Tagging",',
        '+  ]',
        '+}',
      ].join('\n'),
    });

    coreMocks.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'github-token';
        case 'collapse-threshold':
          return '5';
        case 'file-patterns':
          return '**/*.json,**/*.yaml,**/*.yml,**/*.tf,**/*.ts,**/*.js';
        default:
          return '';
      }
    });

    githubMocks.getOctokit.mockReturnValue({
      paginate,
      rest: {
        pulls: {
          listFiles: listFilesRoute,
          listReviewComments: listReviewCommentsRoute,
          createReview,
          updateReviewComment,
          deleteReviewComment,
        },
      },
    });
  });

  it('creates one review comment and reuses it unchanged on a second run', async () => {
    await runAction();
    await runAction();

    expect(createReview).toHaveBeenCalledTimes(1);
    expect(updateReviewComment).not.toHaveBeenCalled();
    expect(deleteReviewComment).not.toHaveBeenCalled();
    expect(reviewComments).toHaveLength(1);

    const [comment] = reviewComments;

    expect(comment?.path).toBe('fixtures/e2e/smoke/policy.tf');
    expect(comment?.line).toBe(3);
    expect(comment?.body).toContain('**IAM Wildcard Expansion**');
    expect(comment?.body).toContain('`s3:Get*Tagging` expands to 5 action(s):');
    expect(comment?.body).toContain('[`s3:GetBucketTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#:~:text=GetBucketTagging)');
    expect(comment?.body).toContain('[`s3:GetJobTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#:~:text=GetJobTagging)');
    expect(comment?.body).toContain('[`s3:GetObjectTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#:~:text=GetObjectTagging)');
    expect(comment?.body).toContain('[`s3:GetObjectVersionTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#:~:text=GetObjectVersionTagging)');
    expect(comment?.body).toContain('[`s3:GetStorageLensConfigurationTagging`](https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazons3.html#:~:text=GetStorageLensConfigurationTagging)');

    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 1 created, 0 updated, 0 unchanged',
    );
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 0 created, 0 updated, 1 unchanged',
    );
  });
});
