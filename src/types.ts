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

export interface PullRequestFile {
  readonly filename: string;
  readonly patch?: string;
}
