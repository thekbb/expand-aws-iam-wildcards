import type { PullRequestFile, WildcardMatch } from './types.js';
export interface DiffResults {
    readonly wildcardMatches: WildcardMatch[];
}
export declare function parseHunkHeader(line: string): number | null;
export declare function extractFromDiff(files: readonly PullRequestFile[]): DiffResults;
//# sourceMappingURL=diff.d.ts.map