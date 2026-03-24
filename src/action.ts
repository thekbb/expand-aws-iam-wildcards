import type {
  ExplicitActionMatch,
  PullRequestFile,
  ReviewComment,
  WildcardBlock,
  WildcardMatch,
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
  readonly redundantActions: string[];
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

export function findRedundantActions(
  explicitActions: readonly string[],
  expandedActions: readonly string[],
): string[] {
  const allExpanded = new Set(expandedActions.map((action) => action.toLowerCase()));
  const seen = new Set<string>();

  return explicitActions.filter((action) => {
    const normalizedAction = action.toLowerCase();
    if (!allExpanded.has(normalizedAction) || seen.has(normalizedAction)) {
      return false;
    }

    seen.add(normalizedAction);
    return true;
  });
}

function getExplicitActionsForBlock(
  block: WildcardBlock,
  explicitActionMatches: readonly ExplicitActionMatch[],
): string[] {
  return explicitActionMatches
    .filter((match) =>
      match.file === block.file &&
      match.line >= block.startLine &&
      match.line <= block.endLine,
    )
    .map((match) => match.action);
}

export function findDuplicateWildcardActions(actions: readonly string[]): string[] {
  const firstSeen = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const action of actions) {
    const normalizedAction = action.toLowerCase();
    if (firstSeen.has(normalizedAction)) {
      duplicates.add(normalizedAction);
      continue;
    }

    firstSeen.set(normalizedAction, action);
  }

  return [...duplicates].map((normalizedAction) => firstSeen.get(normalizedAction) ?? normalizedAction);
}

function getWildcardActionsForBlock(
  block: WildcardBlock,
  wildcardMatches: readonly WildcardMatch[],
): string[] {
  return wildcardMatches
    .filter((match) =>
      match.file === block.file &&
      match.line >= block.startLine &&
      match.line <= block.endLine,
    )
    .map((match) => match.action);
}

function buildReviewComments(
  blocks: readonly WildcardBlock[],
  wildcardMatches: readonly WildcardMatch[],
  expandedActions: Map<string, string[]>,
  explicitActionMatches: readonly ExplicitActionMatch[],
  collapseThreshold: number,
  options: ReviewCommentOptions = {},
): ReviewCommentsResult {
  const comments: ReviewComment[] = [];
  const truncatedComments: TruncatedComment[] = [];
  const redundantActions: string[] = [];

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
    const duplicatePatterns = findDuplicateWildcardActions(
      getWildcardActionsForBlock(block, wildcardMatches),
    );
    const blockRedundantActions = findRedundantActions(
      getExplicitActionsForBlock(block, explicitActionMatches),
      uniqueExpanded,
    );
    redundantActions.push(...blockRedundantActions);

    const formatOptions: FormatOptions = {
      collapseThreshold,
      duplicatePatterns,
      redundantActions: blockRedundantActions,
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
    redundantActions: [...new Set(redundantActions.map((action) => action.toLowerCase()))]
      .map((normalizedAction) =>
        redundantActions.find((action) => action.toLowerCase() === normalizedAction) ?? normalizedAction,
      ),
  };
}

export function createReviewComments(
  blocks: readonly WildcardBlock[],
  wildcardMatches: readonly WildcardMatch[],
  expandedActions: Map<string, string[]>,
  explicitActionMatches: readonly ExplicitActionMatch[],
  collapseThreshold: number,
  options: ReviewCommentOptions = {},
): ReviewComment[] {
  return buildReviewComments(
    blocks,
    wildcardMatches,
    expandedActions,
    explicitActionMatches,
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
  readonly redundantActions: string[];
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
      redundantActions: [],
      stats: { filesScanned: 0, wildcardsFound: 0, blocksCreated: 0, actionsExpanded: 0 },
      truncatedComments: [],
    };
  }

  const { wildcardMatches, explicitActionMatches } = extractFromDiff(filteredFiles);

  if (wildcardMatches.length === 0) {
    return {
      comments: [],
      redundantActions: [],
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
      redundantActions: [],
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
    wildcardMatches,
    expandedActions,
    explicitActionMatches,
    collapseThreshold,
    options,
  );

  return {
    comments: reviewComments.comments,
    redundantActions: reviewComments.redundantActions,
    stats: {
      filesScanned: filteredFiles.length,
      wildcardsFound: wildcardMatches.length,
      blocksCreated: blocks.length,
      actionsExpanded: expandedActions.size,
    },
    truncatedComments: reviewComments.truncatedComments,
  };
}
