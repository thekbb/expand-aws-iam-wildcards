import type { WildcardMatch, WildcardBlock } from './types.js';
export declare const MAX_COMMENT_BODY_LENGTH = 62000;
export declare function findPotentialWildcardActions(line: string): string[];
export declare function groupIntoConsecutiveBlocks(matches: readonly WildcardMatch[]): WildcardBlock[];
export interface FormatOptions {
    readonly collapseThreshold?: number;
    readonly truncationUrl?: string;
    readonly maxCommentBodyLength?: number;
}
export interface FormattedComment {
    readonly body: string;
    readonly renderedActionsCount: number;
    readonly truncated: boolean;
}
export declare function formatCommentResult(originalActions: readonly string[], expandedActions: readonly string[], options?: FormatOptions): FormattedComment;
export declare function formatComment(originalActions: readonly string[], expandedActions: readonly string[], options?: FormatOptions): string;
//# sourceMappingURL=utils.d.ts.map