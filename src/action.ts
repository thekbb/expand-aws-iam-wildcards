import type {
  PullRequestFile,
  ReviewComment,
  WildcardBlock,
} from './types.js';
import { extractFromDiff } from './diff.js';
import { groupIntoConsecutiveBlocks, formatCommentResult, type FormatOptions } from './utils.js';
import { expandIamAction } from './expand.js';
import { matchesPatterns } from './patterns.js';

export const COMMENT_MARKER = '**IAM Wildcard Expansion**';

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

interface ReviewCommentsResult {
  readonly comments: ReviewComment[];
  readonly truncatedComments: TruncatedComment[];
}

export function expandWildcards(actions: readonly string[]): Map<string, string[]> {
  const expanded = new Map<string, string[]>();

  for (const action of actions) {
    const result = expandIamAction(action);
    const isValidExpansion = result.length > 1 ||
      (result.length === 1 && result[0]?.toLowerCase() !== action.toLowerCase());

    if (isValidExpansion) {
      expanded.set(action, result);
    }
  }

  return expanded;
}

function buildReviewComments(
  blocks: readonly WildcardBlock[],
  expandedActions: Map<string, string[]>,
  collapseThreshold: number,
  options: ReviewCommentOptions = {},
): ReviewCommentsResult {
  const comments: ReviewComment[] = [];
  const truncatedComments: TruncatedComment[] = [];

  for (const block of blocks) {
    const originalActions: string[] = [];
    const allExpanded: string[] = [];

    for (const action of block.actions) {
      const expanded = expandedActions.get(action);
      if (expanded) {
        originalActions.push(action);
        allExpanded.push(...expanded);
      }
    }

    if (allExpanded.length === 0) {
      continue;
    }

    const uniqueExpanded = [...new Set(allExpanded)].toSorted((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    const formatOptions: FormatOptions = {
      collapseThreshold,
      truncationUrl: options.truncationUrl,
      maxCommentBodyLength: options.maxCommentBodyLength,
    };
    const formattedComment = formatCommentResult(originalActions, uniqueExpanded, formatOptions);

    comments.push({
      path: block.file,
      line: block.endLine,
      body: formattedComment.body,
    });

    if (formattedComment.truncated) {
      truncatedComments.push({
        file: block.file,
        line: block.endLine,
        originalActions,
        expandedActions: uniqueExpanded,
        renderedActionsCount: formattedComment.renderedActionsCount,
      });
    }
  }

  return {
    comments,
    truncatedComments,
  };
}

export function createReviewComments(
  blocks: readonly WildcardBlock[],
  expandedActions: Map<string, string[]>,
  collapseThreshold: number,
  options: ReviewCommentOptions = {},
): ReviewComment[] {
  return buildReviewComments(
    blocks,
    expandedActions,
    collapseThreshold,
    options,
  ).comments;
}

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

export function processFiles(
  files: readonly PullRequestFile[],
  filePatterns: readonly string[],
  collapseThreshold: number,
  options: ReviewCommentOptions = {},
): ProcessingResult {
  const filteredFiles = filePatterns.length > 0
    ? files.filter((f) => matchesPatterns(f.filename, filePatterns))
    : files;

  if (filteredFiles.length === 0) {
    return {
      comments: [],
      stats: { filesScanned: 0, wildcardsFound: 0, blocksCreated: 0, actionsExpanded: 0 },
      truncatedComments: [],
    };
  }

  const { wildcardMatches } = extractFromDiff(filteredFiles);

  if (wildcardMatches.length === 0) {
    return {
      comments: [],
      stats: { filesScanned: filteredFiles.length, wildcardsFound: 0, blocksCreated: 0, actionsExpanded: 0 },
      truncatedComments: [],
    };
  }

  const blocks = groupIntoConsecutiveBlocks(wildcardMatches);
  const uniqueActions = [...new Set(wildcardMatches.map((m) => m.action))];
  const expandedActions = expandWildcards(uniqueActions);

  if (expandedActions.size === 0) {
    return {
      comments: [],
      stats: {
        filesScanned: filteredFiles.length,
        wildcardsFound: wildcardMatches.length,
        blocksCreated: blocks.length,
        actionsExpanded: 0,
      },
      truncatedComments: [],
    };
  }

  const reviewComments = buildReviewComments(
    blocks,
    expandedActions,
    collapseThreshold,
    options,
  );

  return {
    comments: reviewComments.comments,
    stats: {
      filesScanned: filteredFiles.length,
      wildcardsFound: wildcardMatches.length,
      blocksCreated: blocks.length,
      actionsExpanded: expandedActions.size,
    },
    truncatedComments: reviewComments.truncatedComments,
  };
}
