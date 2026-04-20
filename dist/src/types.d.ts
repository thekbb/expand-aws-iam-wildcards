export interface WildcardMatch {
    readonly action: string;
    readonly line: number;
    readonly file: string;
}
export interface WildcardBlock {
    readonly file: string;
    readonly startLine: number;
    readonly endLine: number;
    readonly actions: readonly string[];
}
export interface ReviewComment {
    readonly path: string;
    readonly line: number;
    readonly body: string;
}
export interface PullRequestReviewComment {
    readonly id: number;
    readonly body: string;
    readonly in_reply_to_id?: number | null;
    readonly hasReplies?: boolean;
    readonly path?: string;
    readonly position?: number | null;
    readonly line?: number | null;
    readonly original_line?: number | null;
}
export interface PullRequestFile {
    readonly filename: string;
    readonly patch?: string;
}
//# sourceMappingURL=types.d.ts.map