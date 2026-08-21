import type { PullRequestFile, PullRequestReviewComment, ReviewComment } from './types.js';
import { hasCurrentCommentMarker, hasLegacyCommentShape } from './comment-identity.js';
import { extractFromDiff, recoverFilePatchesFromDiff } from './diff.js';

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
    readonly users?: {
      readonly getAuthenticated?: () => Promise<{
        readonly data: { readonly login: string };
      }>;
    };
  };
  readonly graphql?: (query: string) => Promise<{
    readonly viewer: { readonly login: string };
  }>;
}

interface PullRequestFilesClient extends PaginatedPullsClient<PullRequestFile> {
  readonly request: (
    route: string,
    parameters: {
      owner: string;
      repo: string;
      pull_number: number;
      headers: { readonly accept: string };
    },
  ) => Promise<{ readonly data: unknown }>;
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
  readonly deleteStaleComments?: boolean;
}

export interface SyncReviewCommentsResult {
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly unchangedCount: number;
  readonly deletedCount: number;
  readonly failedDeleteCount: number;
  readonly preservedCount: number;
}

function getAnchorKey(path: string, line: number): string {
  return JSON.stringify([path, line]);
}

function getExistingCommentAnchorKey(comment: PullRequestReviewComment): string | null {
  if (!comment.path) {
    return null;
  }

  // A null position means GitHub has already marked the inline comment outdated.
  // Updating it in place will not recreate a current thread on the active diff.
  if (comment.position === null) {
    return null;
  }

  if (comment.line === null || comment.line === undefined) {
    return null;
  }

  return getAnchorKey(comment.path, comment.line);
}

export async function listPullRequestFiles(
  octokit: PullRequestFilesClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const needsFallback = extractFromDiff(files).files.some((file) =>
    file.state === 'missing-patch' || file.state === 'failed',
  );
  if (!needsFallback) return files;

  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: 'application/vnd.github.diff' },
    });
    return typeof response.data === 'string'
      ? recoverFilePatchesFromDiff(files, response.data)
      : files;
  } catch {
    return files;
  }
}

export async function listActionReviewComments(
  octokit: PaginatedPullsClient<PullRequestReviewComment>,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestReviewComment[]> {
  const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  const parentCommentIdsWithReplies = new Set<number>(
    reviewComments
      .map((comment) => comment.in_reply_to_id)
      .filter((commentId): commentId is number => commentId !== null && commentId !== undefined),
  );

  // TODO(v2): Require the current machine marker and remove the legacy shape
  // fallback after supported v1 comments have had time to migrate in place.
  const candidates = reviewComments.filter((comment) =>
    hasCurrentCommentMarker(comment.body) || hasLegacyCommentShape(comment.body),
  );
  let authenticatedLogin: string | undefined;

  if (candidates.length > 0) {
    try {
      const response = await octokit.rest.users?.getAuthenticated?.();
      authenticatedLogin = response?.data.login;
    } catch {
      // Installation tokens do not authenticate as users. GraphQL's viewer
      // resolves the bot identity used for their comments.
    }

    if (authenticatedLogin === undefined) {
      try {
        const response = await octokit.graphql?.(
          'query ExpandAwsIamWildcardsViewer { viewer { login } }',
        );
        authenticatedLogin = response?.viewer.login;
      } catch {
        // An unresolved token identity leaves all candidates unmanaged.
      }
    }
  }

  return candidates
    .filter((comment) => {
      const login = comment.user?.login;
      if (!login || authenticatedLogin === undefined) return false;

      const normalizedLogin = login.toLowerCase();
      const normalizedAuthenticatedLogin = authenticatedLogin.toLowerCase();
      if (comment.user?.type === 'Bot') {
        return normalizedLogin.replace(/\[bot\]$/, '')
          === normalizedAuthenticatedLogin.replace(/\[bot\]$/, '');
      }

      return comment.user?.type === 'User'
        && normalizedLogin === normalizedAuthenticatedLogin;
    })
    .map((comment) =>
      parentCommentIdsWithReplies.has(comment.id)
        ? { ...comment, hasReplies: true }
        : comment,
    );
}

export async function syncReviewComments(
  octokit: ReviewSyncClient,
  params: SyncReviewCommentsParams,
): Promise<SyncReviewCommentsResult> {
  const {
    owner,
    repo,
    pullNumber,
    commitSha,
    comments,
    existingComments,
    deleteStaleComments = true,
  } = params;
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

    const exactMatch =
      existingAtAnchor.find((existingComment) =>
        existingComment.body === comment.body && existingComment.hasReplies,
      ) ??
      existingAtAnchor.find((existingComment) => existingComment.body === comment.body);
    if (exactMatch) {
      unchangedCount += 1;
      staleComments.push(...existingAtAnchor.filter((existingComment) => existingComment.id !== exactMatch.id));
      existingCommentsByAnchor.delete(anchorKey);
      continue;
    }

    const [firstComment] = existingAtAnchor as [PullRequestReviewComment, ...PullRequestReviewComment[]];
    const commentToUpdate =
      existingAtAnchor.find((existingComment) => existingComment.hasReplies) ??
      firstComment;
    const duplicateComments = existingAtAnchor.filter(
      (existingComment) => existingComment.id !== commentToUpdate.id,
    );
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
  let preservedCount = 0;

  for (const comment of staleComments) {
    if (!deleteStaleComments || comment.hasReplies) {
      preservedCount += 1;
      continue;
    }

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
    preservedCount,
  };
}
