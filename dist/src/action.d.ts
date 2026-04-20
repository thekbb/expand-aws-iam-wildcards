import type { PullRequestFile, ReviewComment, WildcardBlock } from './types.js';
export declare const COMMENT_MARKER = "**IAM Wildcard Expansion**";
export interface ReviewCommentOptions {
    readonly truncationUrl?: string;
    readonly maxCommentBodyLength?: number;
}
export interface TruncatedComment {
    readonly file: string;
    readonly line: number;
    readonly originalActions: readonly string[];
    readonly expandedActions: readonly string[];
    readonly renderedActionsCount: number;
}
export declare function expandWildcards(actions: readonly string[]): Map<string, string[]>;
export declare function createReviewComments(blocks: readonly WildcardBlock[], expandedActions: Map<string, string[]>, collapseThreshold: number, options?: ReviewCommentOptions): ReviewComment[];
export interface ProcessingStats {
    readonly filesScanned: number;
    readonly wildcardsFound: number;
    readonly blocksCreated: number;
    readonly actionsExpanded: number;
}
export interface ProcessingResult {
    readonly comments: ReviewComment[];
    readonly stats: ProcessingStats;
    readonly truncatedComments: TruncatedComment[];
}
export declare function processFiles(files: readonly PullRequestFile[], filePatterns: readonly string[], collapseThreshold: number, options?: ReviewCommentOptions): ProcessingResult;
//# sourceMappingURL=action.d.ts.map