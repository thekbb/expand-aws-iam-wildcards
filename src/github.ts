import type { PullRequestFile, PullRequestReviewComment, ReviewComment } from './types.js';

interface PaginatedPullsClient<TItem> {
  readonly paginate: (
    route: unknown,
    parameters: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
    },
  ) => Promise<TItem[]>;
  readonly rest: {
    readonly pulls: {
      readonly listFiles?: unknown;
      readonly listReviewComments?: unknown;
    };
  };
}

interface ReviewSyncClient {
  readonly rest: {
    readonly pulls: {
      readonly createReview: (parameters: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        event: 'COMMENT';
        comments: ReviewComment[];
      }) => Promise<unknown>;
      readonly updateReviewComment: (parameters: {
        owner: string;
        repo: string;
        comment_id: number;
        body: string;
      }) => Promise<unknown>;
      readonly deleteReviewComment: (parameters: {
        owner: string;
        repo: string;
        comment_id: number;
      }) => Promise<unknown>;
    };
  };
}

export interface SyncReviewCommentsParams {
  readonly owner: string;
  readonly repo: string;
  readonly pullNumber: number;
  readonly commitSha: string;
  readonly comments: ReviewComment[];
  readonly existingComments: readonly PullRequestReviewComment[];
}

export interface SyncReviewCommentsResult {
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly deletedCount: number;
  readonly failedDeleteCount: number;
}

function getAnchorKey(path: string, line: number): string {
  return JSON.stringify([path, line]);
}

function getExistingCommentAnchorKey(comment: PullRequestReviewComment): string | null {
  if (!comment.path) {
    return null;
  }

  const line = comment.line ?? comment.original_line;
  if (line === null || line === undefined) {
    return null;
  }

  return getAnchorKey(comment.path, line);
}

export async function listPullRequestFiles(
  octokit: PaginatedPullsClient<PullRequestFile>,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestFile[]> {
  return octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
}

export async function listActionReviewComments(
  octokit: PaginatedPullsClient<PullRequestReviewComment>,
  owner: string,
  repo: string,
  pullNumber: number,
  marker: string,
): Promise<PullRequestReviewComment[]> {
  const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return reviewComments.filter((comment) => comment.body.includes(marker));
}

export async function syncReviewComments(
  octokit: ReviewSyncClient,
  params: SyncReviewCommentsParams,
): Promise<SyncReviewCommentsResult> {
  const { owner, repo, pullNumber, commitSha, comments, existingComments } = params;
  const existingCommentsByAnchor = new Map<string, PullRequestReviewComment[]>();
  const staleComments: PullRequestReviewComment[] = [];

  for (const comment of existingComments) {
    const anchorKey = getExistingCommentAnchorKey(comment);
    if (!anchorKey) {
      staleComments.push(comment);
      continue;
    }

    const commentsAtAnchor = existingCommentsByAnchor.get(anchorKey);
    if (commentsAtAnchor) {
      commentsAtAnchor.push(comment);
    } else {
      existingCommentsByAnchor.set(anchorKey, [comment]);
    }
  }

  const commentsToCreate: ReviewComment[] = [];
  const commentsToUpdate: PullRequestReviewComment[] = [];
  let unchangedCount = 0;

  for (const comment of comments) {
    const anchorKey = getAnchorKey(comment.path, comment.line);
    const existingAtAnchor = existingCommentsByAnchor.get(anchorKey);

    if (!existingAtAnchor || existingAtAnchor.length === 0) {
      commentsToCreate.push(comment);
      continue;
    }

    const exactMatch = existingAtAnchor.find((existingComment) => existingComment.body === comment.body);
    if (exactMatch) {
      unchangedCount += 1;
      staleComments.push(...existingAtAnchor.filter((existingComment) => existingComment.id !== exactMatch.id));
      existingCommentsByAnchor.delete(anchorKey);
      continue;
    }

    const [commentToUpdate, ...duplicateComments] =
      existingAtAnchor as [PullRequestReviewComment, ...PullRequestReviewComment[]];
    commentsToUpdate.push({
      ...commentToUpdate,
      body: comment.body,
    });
    staleComments.push(...duplicateComments);
    existingCommentsByAnchor.delete(anchorKey);
  }

  for (const unmatchedComments of existingCommentsByAnchor.values()) {
    staleComments.push(...unmatchedComments);
  }

  for (const comment of commentsToUpdate) {
    await octokit.rest.pulls.updateReviewComment({
      owner,
      repo,
      comment_id: comment.id,
      body: comment.body,
    });
  }

  if (commentsToCreate.length > 0) {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: commitSha,
      event: 'COMMENT',
      comments: commentsToCreate,
    });
  }

  let deletedCount = 0;
  let failedDeleteCount = 0;

  for (const comment of staleComments) {
    try {
      await octokit.rest.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: comment.id,
      });
      deletedCount += 1;
    } catch {
      failedDeleteCount += 1;
    }
  }

  return {
    createdCount: commentsToCreate.length,
    updatedCount: commentsToUpdate.length,
    unchangedCount,
    deletedCount,
    failedDeleteCount,
  };
}
