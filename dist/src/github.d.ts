import type { PullRequestFile, PullRequestReviewComment, ReviewComment } from './types.js';
interface PaginatedPullsClient<TItem> {
    readonly paginate: (route: unknown, parameters: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
    }) => Promise<TItem[]>;
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
    readonly preservedCount: number;
}
export declare function listPullRequestFiles(octokit: PaginatedPullsClient<PullRequestFile>, owner: string, repo: string, pullNumber: number): Promise<PullRequestFile[]>;
export declare function listActionReviewComments(octokit: PaginatedPullsClient<PullRequestReviewComment>, owner: string, repo: string, pullNumber: number, marker: string): Promise<PullRequestReviewComment[]>;
export declare function syncReviewComments(octokit: ReviewSyncClient, params: SyncReviewCommentsParams): Promise<SyncReviewCommentsResult>;
export {};
//# sourceMappingURL=github.d.ts.map