import type { PullRequestFile, ReviewComment, WildcardBlock } from './types.js';
import { extractFromDiff } from './diff.js';
import { groupIntoConsecutiveBlocks, formatComment, type FormatOptions } from './utils.js';
import { expandIamAction } from './expand.js';
import { matchesPatterns } from './patterns.js';

export const COMMENT_MARKER = '**IAM Wildcard Expansion**';

export function expandWildcards(actions: readonly string[]): Map<string, string[]> {
  const expanded = new Map<string, string[]>();

  for (const action of actions) {
    const result = expandIamAction(action);
    const isValidExpansion = result.length > 1 ||
      (result.length === 1 && result[0].toLowerCase() !== action.toLowerCase());

    if (isValidExpansion) {
      expanded.set(action, result);
    }
  }

  return expanded;
}

export function findRedundantActions(
  explicitActions: readonly string[],
  expandedActions: Map<string, string[]>,
): string[] {
  const allExpanded = new Set<string>();
  for (const actions of expandedActions.values()) {
    for (const action of actions) {
      allExpanded.add(action.toLowerCase());
    }
  }

  return explicitActions.filter((action) =>
    allExpanded.has(action.toLowerCase())
  );
}

export function createReviewComments(
  blocks: readonly WildcardBlock[],
  expandedActions: Map<string, string[]>,
  redundantActions: readonly string[],
  collapseThreshold: number,
): ReviewComment[] {
  return blocks.flatMap((block) => {
    const originalActions: string[] = [];
    const allExpanded: string[] = [];

    for (const action of block.actions) {
      const expanded = expandedActions.get(action);
      if (expanded) {
        originalActions.push(action);
        allExpanded.push(...expanded);
      }
    }

    if (allExpanded.length === 0) return [];

    const uniqueExpanded = [...new Set(allExpanded)].toSorted((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );

    const options: FormatOptions = { collapseThreshold, redundantActions };

    return {
      path: block.file,
      line: block.endLine,
      body: formatComment(originalActions, uniqueExpanded, options),
    };
  });
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
}

export function processFiles(
  files: readonly PullRequestFile[],
  filePatterns: readonly string[],
  collapseThreshold: number,
): ProcessingResult {
  const filteredFiles = filePatterns.length > 0
    ? files.filter((f) => matchesPatterns(f.filename, filePatterns))
    : files;

  if (filteredFiles.length === 0) {
    return {
      comments: [],
      redundantActions: [],
      stats: { filesScanned: 0, wildcardsFound: 0, blocksCreated: 0, actionsExpanded: 0 },
    };
  }

  const { wildcardMatches, explicitActions } = extractFromDiff(filteredFiles);

  if (wildcardMatches.length === 0) {
    return {
      comments: [],
      redundantActions: [],
      stats: { filesScanned: filteredFiles.length, wildcardsFound: 0, blocksCreated: 0, actionsExpanded: 0 },
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
    };
  }

  const redundantActions = findRedundantActions(explicitActions, expandedActions);
  const comments = createReviewComments(blocks, expandedActions, redundantActions, collapseThreshold);

  return {
    comments,
    redundantActions,
    stats: {
      filesScanned: filteredFiles.length,
      wildcardsFound: wildcardMatches.length,
      blocksCreated: blocks.length,
      actionsExpanded: expandedActions.size,
    },
  };
}
