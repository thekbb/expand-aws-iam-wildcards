import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  getInput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));

const githubMocks = vi.hoisted(() => ({
  context: {
    payload: {},
    repo: {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
    },
  },
  getOctokit: vi.fn(),
}));

const actionMocks = vi.hoisted(() => ({
  COMMENT_MARKER: '**IAM Wildcard Expansion**',
  processFiles: vi.fn(),
}));

const githubApiMocks = vi.hoisted(() => ({
  listActionReviewComments: vi.fn(),
  listPullRequestFiles: vi.fn(),
  syncReviewComments: vi.fn(),
}));

vi.mock('@actions/core', () => coreMocks);
vi.mock('@actions/github', () => githubMocks);
vi.mock('./action.js', () => actionMocks);
vi.mock('./github.js', () => githubApiMocks);

import { runAction } from './main.js';

describe('runAction', () => {
  const originalGithubRunId = process.env.GITHUB_RUN_ID;
  const originalGithubServerUrl = process.env.GITHUB_SERVER_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_RUN_ID;
    delete process.env.GITHUB_SERVER_URL;

    githubMocks.context.payload = {};
    githubMocks.context.repo = {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
    };
    githubMocks.getOctokit.mockReturnValue({ tag: 'octokit' });

    coreMocks.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'github-token';
        case 'collapse-threshold':
          return '5';
        case 'file-patterns':
          return '**/*.tf,**/*.json';
        default:
          return '';
      }
    });

    githubApiMocks.listActionReviewComments.mockResolvedValue([]);
    githubApiMocks.listPullRequestFiles.mockResolvedValue([]);
    githubApiMocks.syncReviewComments.mockResolvedValue({
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 0,
    });
    actionMocks.processFiles.mockReturnValue({
      comments: [],
      stats: {
        filesScanned: 0,
        wildcardsFound: 0,
        blocksCreated: 0,
        actionsExpanded: 0,
      },
      truncatedComments: [],
    });
  });

  afterAll(() => {
    if (originalGithubRunId === undefined) {
      delete process.env.GITHUB_RUN_ID;
    } else {
      process.env.GITHUB_RUN_ID = originalGithubRunId;
    }

    if (originalGithubServerUrl === undefined) {
      delete process.env.GITHUB_SERVER_URL;
    } else {
      process.env.GITHUB_SERVER_URL = originalGithubServerUrl;
    }
  });

  it('skips cleanly outside pull request events', async () => {
    await runAction();

    expect(coreMocks.info).toHaveBeenCalledWith('This action only runs on pull requests. Skipping.');
    expect(coreMocks.getInput).not.toHaveBeenCalled();
    expect(githubMocks.getOctokit).not.toHaveBeenCalled();
  });

  it('syncs empty comments when no files match the configured patterns', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'deadbeef',
        },
      },
    };

    await runAction();

    expect(githubApiMocks.listActionReviewComments).toHaveBeenCalledWith(
      { tag: 'octokit' },
      'thekbb',
      'expand-aws-iam-wildcards',
      42,
      '**IAM Wildcard Expansion**',
    );
    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 42,
      commitSha: 'deadbeef',
      comments: [],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith('No files matched the configured patterns.');
  });

  it('syncs generated comments for a normal pull request run', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123',
        },
      },
    };
    githubApiMocks.listActionReviewComments.mockResolvedValue([{ id: 99 }]);
    githubApiMocks.listPullRequestFiles.mockResolvedValue([{ filename: 'policy.tf', patch: '+ "s3:Get*"' }]);
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [],
    });
    githubApiMocks.syncReviewComments.mockResolvedValue({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 0,
    });

    await runAction();

    expect(actionMocks.processFiles).toHaveBeenCalledWith(
      [{ filename: 'policy.tf', patch: '+ "s3:Get*"' }],
      ['**/*.tf', '**/*.json'],
      5,
      { truncationUrl: undefined },
    );
    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 42,
      commitSha: 'abc123',
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      existingComments: [{ id: 99 }],
    });
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 1 created, 0 updated, 0 unchanged',
    );
  });

  it('logs truncated comment details with a workflow run URL', async () => {
    process.env.GITHUB_RUN_ID = '24570015955';
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [{
        file: 'policy.tf',
        line: 10,
        originalActions: ['s3:*'],
        expandedActions: ['s3:GetObject', 's3:PutObject'],
        renderedActionsCount: 1,
      }],
    });

    await runAction();

    expect(actionMocks.processFiles).toHaveBeenCalledWith(
      [],
      ['**/*.tf', '**/*.json'],
      5,
      {
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/24570015955',
      },
    );
    expect(coreMocks.warning).toHaveBeenCalledWith(
      'Truncated 1 review comment(s) to stay within GitHub comment limits. Full lists are available in this workflow run: https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/24570015955',
    );
    expect(coreMocks.info).toHaveBeenCalledWith(
      [
        'Full IAM expansion for policy.tf:10',
        'Rendered 1 of 2 action(s) in the PR comment.',
        'Wildcard patterns: s3:*',
        '- s3:GetObject',
        '- s3:PutObject',
      ].join('\n'),
    );
  });

  it('uses the default GitHub URL when a workflow run ID is present without GITHUB_SERVER_URL', async () => {
    process.env.GITHUB_RUN_ID = '24570015955';
    githubMocks.context.payload = {
      pull_request: {
        number: 9000,
        head: {
          sha: 'decafbad',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [],
    });

    await runAction();

    expect(actionMocks.processFiles).toHaveBeenCalledWith(
      [],
      ['**/*.tf', '**/*.json'],
      5,
      {
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/24570015955',
      },
    );
  });

  it('logs truncated comment details without a workflow run URL when none is available', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 9000,
        head: {
          sha: 'badc0de',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [{
        file: 'policy.tf',
        line: 10,
        originalActions: ['s3:*'],
        expandedActions: ['s3:GetObject', 's3:PutObject'],
        renderedActionsCount: 1,
      }],
    });

    await runAction();

    expect(actionMocks.processFiles).toHaveBeenCalledWith(
      [],
      ['**/*.tf', '**/*.json'],
      5,
      { truncationUrl: undefined },
    );
    expect(coreMocks.warning).toHaveBeenCalledWith(
      'Truncated 1 review comment(s) to stay within GitHub comment limits.',
    );
    expect(coreMocks.info).toHaveBeenCalledWith(
      [
        'Full IAM expansion for policy.tf:10',
        'Rendered 1 of 2 action(s) in the PR comment.',
        'Wildcard patterns: s3:*',
        '- s3:GetObject',
        '- s3:PutObject',
      ].join('\n'),
    );
  });

  it('syncs empty comments when scanned files contain no IAM wildcards', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [],
      stats: {
        filesScanned: 2,
        wildcardsFound: 0,
        blocksCreated: 0,
        actionsExpanded: 0,
      },
      truncatedComments: [],
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 42,
      commitSha: 'abc123',
      comments: [],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith('Scanned 2 file(s)');
    expect(coreMocks.info).toHaveBeenCalledWith('No IAM wildcard actions found in the changes.');
  });

  it('syncs empty comments when found wildcards do not expand', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 1337,
        head: {
          sha: 'babecafe',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [],
      stats: {
        filesScanned: 1,
        wildcardsFound: 2,
        blocksCreated: 1,
        actionsExpanded: 0,
      },
      truncatedComments: [],
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 1337,
      commitSha: 'babecafe',
      comments: [],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith('Scanned 1 file(s)');
    expect(coreMocks.info).toHaveBeenCalledWith('Found 2 wildcard(s), grouped into 1 block(s)');
    expect(coreMocks.info).toHaveBeenCalledWith('No wildcard actions could be expanded.');
  });

  it('syncs empty comments when expanded wildcards still produce no comments', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 1337,
        head: {
          sha: 'badc0de',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [],
      stats: {
        filesScanned: 1,
        wildcardsFound: 2,
        blocksCreated: 1,
        actionsExpanded: 2,
      },
      truncatedComments: [],
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 1337,
      commitSha: 'badc0de',
      comments: [],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith('Scanned 1 file(s)');
    expect(coreMocks.info).toHaveBeenCalledWith('Found 2 wildcard(s), grouped into 1 block(s)');
    expect(coreMocks.info).toHaveBeenCalledWith('No comments to post.');
  });

  it('logs deleted stale review comments after a successful sync', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 9000,
        head: {
          sha: 'decafbad',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [],
    });
    githubApiMocks.syncReviewComments.mockResolvedValue({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 2,
      failedDeleteCount: 0,
      preservedCount: 0,
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 9000,
      commitSha: 'decafbad',
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 1 created, 0 updated, 0 unchanged',
    );
    expect(coreMocks.info).toHaveBeenCalledWith('Deleted 2 existing comment(s) from previous runs');
  });

  it('logs failed stale comment deletions after a successful sync', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 9000,
        head: {
          sha: 'badc0de',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [],
    });
    githubApiMocks.syncReviewComments.mockResolvedValue({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 2,
      preservedCount: 0,
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 9000,
      commitSha: 'badc0de',
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 1 created, 0 updated, 0 unchanged',
    );
    expect(coreMocks.warning).toHaveBeenCalledWith(
      'Failed to delete 2 stale comment(s) from previous runs',
    );
  });

  it('logs preserved stale review threads after a successful sync', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 8675309,
        head: {
          sha: 'decafbad',
        },
      },
    };
    actionMocks.processFiles.mockReturnValue({
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      stats: {
        filesScanned: 1,
        wildcardsFound: 1,
        blocksCreated: 1,
        actionsExpanded: 1,
      },
      truncatedComments: [],
    });
    githubApiMocks.syncReviewComments.mockResolvedValue({
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      deletedCount: 0,
      failedDeleteCount: 0,
      preservedCount: 2,
    });

    await runAction();

    expect(githubApiMocks.syncReviewComments).toHaveBeenCalledWith({ tag: 'octokit' }, {
      owner: 'thekbb',
      repo: 'expand-aws-iam-wildcards',
      pullNumber: 8675309,
      commitSha: 'decafbad',
      comments: [{ path: 'policy.tf', line: 10, body: 'comment body' }],
      existingComments: [],
    });
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Synchronized comments: 1 created, 0 updated, 0 unchanged',
    );
    expect(coreMocks.info).toHaveBeenCalledWith(
      'Preserved 2 stale comment thread(s) because they have replies',
    );
  });

  it('reports failures through core.setFailed', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123',
        },
      },
    };
    githubApiMocks.listActionReviewComments.mockRejectedValue(new Error('GitHub API failed'));

    await runAction();

    expect(coreMocks.setFailed).toHaveBeenCalledWith('GitHub API failed');
  });

  it('reports non-Error failures through the generic failure message', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 9000,
        head: {
          sha: 'badc0de',
        },
      },
    };
    githubApiMocks.listActionReviewComments.mockRejectedValue('boom');

    await runAction();

    expect(coreMocks.setFailed).toHaveBeenCalledWith('An unexpected error occurred');
  });

  it('reports invalid collapse-threshold input through core.setFailed', async () => {
    githubMocks.context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123',
        },
      },
    };
    coreMocks.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'github-token';
        case 'collapse-threshold':
          return '3.5';
        case 'file-patterns':
          return '**/*.tf';
        default:
          return '';
      }
    });

    await runAction();

    expect(coreMocks.setFailed).toHaveBeenCalledWith(
      'Invalid collapse-threshold input: "3.5". Expected a non-negative safe integer.',
    );
    expect(githubApiMocks.listActionReviewComments).not.toHaveBeenCalled();
  });
});
