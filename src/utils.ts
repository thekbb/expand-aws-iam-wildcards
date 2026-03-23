import type { WildcardMatch, WildcardBlock } from './types.js';
import { formatActionWithLink } from './docs.js';

const IAM_WILDCARD_PATTERN = /["']?([a-zA-Z0-9-]+:[a-zA-Z0-9*?]*\*[a-zA-Z0-9*?]*)["']?/g;
const IAM_EXPLICIT_PATTERN = /["']([a-zA-Z0-9-]+:[a-zA-Z][a-zA-Z0-9]*)["']/g;
export const MAX_COMMENT_BODY_LENGTH = 62_000;

export function findPotentialWildcardActions(line: string): string[] {
  return [...line.matchAll(IAM_WILDCARD_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((action): action is string => action !== undefined && action !== '');
}

export function findExplicitActions(line: string): string[] {
  return [...line.matchAll(IAM_EXPLICIT_PATTERN)]
    .map((match) => match[1])
    .filter((action): action is string => action !== undefined && !action.includes('*'));
}

export function groupIntoConsecutiveBlocks(matches: readonly WildcardMatch[]): WildcardBlock[] {
  if (matches.length === 0) return [];

  const sorted = matches.toSorted((a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line
  );

  const first = sorted[0];
  if (!first) return [];

  const blocks: WildcardBlock[] = [];
  let current = {
    file: first.file,
    startLine: first.line,
    endLine: first.line,
    actions: new Set([first.action]),
  };

  for (const match of sorted.slice(1)) {
    const isConsecutive = match.file === current.file && match.line <= current.endLine + 1;

    if (isConsecutive) {
      current.actions.add(match.action);
      current.endLine = Math.max(current.endLine, match.line);
    } else {
      blocks.push({ ...current, actions: [...current.actions] });
      current = {
        file: match.file,
        startLine: match.line,
        endLine: match.line,
        actions: new Set([match.action]),
      };
    }
  }

  blocks.push({ ...current, actions: [...current.actions] });
  return blocks;
}

export interface FormatOptions {
  readonly collapseThreshold?: number;
  readonly redundantActions?: readonly string[];
  readonly truncationUrl?: string;
  readonly maxCommentBodyLength?: number;
}

export interface FormattedComment {
  readonly body: string;
  readonly renderedActionsCount: number;
  readonly truncated: boolean;
}

function createTruncationNotice(
  renderedActionsCount: number,
  totalActionsCount: number,
  truncationUrl?: string,
): string {
  const logMessage = truncationUrl
    ? ` The full expanded list is in the [workflow run logs](${truncationUrl}).`
    : '';

  if (renderedActionsCount === 0) {
    return `\n\nThe expanded action list is omitted here to keep this review comment within GitHub limits.${logMessage}`;
  }

  return `\n\nShowing first ${renderedActionsCount} of ${totalActionsCount} expanded actions to keep this review comment within GitHub limits.${logMessage}`;
}

function buildCommentBody(
  originalActions: readonly string[],
  displayedActions: readonly string[],
  totalExpandedActionsCount: number,
  options: FormatOptions = {},
): string {
  const { collapseThreshold = 5, redundantActions, truncationUrl } = options;

  const header = originalActions.length === 1
    ? `\`${originalActions[0]}\` expands to ${totalExpandedActionsCount} action(s):`
    : `${originalActions.length} wildcard patterns expand to ${totalExpandedActionsCount} action(s):`;

  const patterns = originalActions.length > 1
    ? `\n**Patterns:**\n${originalActions.map((a) => `- \`${a}\``).join('\n')}`
    : '';

  const warning = redundantActions && redundantActions.length > 0
    ? `\n\n**⚠️ Redundant actions detected:**\nThe following explicit actions are already covered by the wildcard pattern(s) above:\n${redundantActions.map((a) => `- \`${a}\``).join('\n')}`
    : '';

  const truncationNotice = displayedActions.length < totalExpandedActionsCount
    ? createTruncationNotice(displayedActions.length, totalExpandedActionsCount, truncationUrl)
    : '';

  const actionsList = displayedActions.map((a) => `1. ${formatActionWithLink(a)}`).join('\n');

  const actionsBlock = displayedActions.length === 0
    ? '_Full expanded list omitted from this comment._'
    : displayedActions.length > collapseThreshold
    ? `<details>
<summary>Click to expand</summary>

${actionsList}

</details>`
    : actionsList;

  return `**IAM Wildcard Expansion**

${header}${patterns}${warning}${truncationNotice}

${actionsBlock}`;
}

function createMinimalCommentBody(truncationUrl?: string): string {
  const logMessage = truncationUrl
    ? ` The full expanded list is in the [workflow run logs](${truncationUrl}).`
    : '';

  return `**IAM Wildcard Expansion**

Expanded actions were omitted from this comment to stay within GitHub limits.${logMessage}`;
}

export function formatCommentResult(
  originalActions: readonly string[],
  expandedActions: readonly string[],
  options: FormatOptions = {},
): FormattedComment {
  const { maxCommentBodyLength = MAX_COMMENT_BODY_LENGTH } = options;
  const safeMaxCommentBodyLength = Math.max(1, maxCommentBodyLength);
  const fullBody = buildCommentBody(originalActions, expandedActions, expandedActions.length, options);

  if (fullBody.length <= safeMaxCommentBodyLength) {
    return {
      body: fullBody,
      renderedActionsCount: expandedActions.length,
      truncated: false,
    };
  }

  let bestCount = 0;
  let bestBody = '';
  let low = 0;
  let high = expandedActions.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateBody = buildCommentBody(
      originalActions,
      expandedActions.slice(0, mid),
      expandedActions.length,
      options,
    );

    if (candidateBody.length <= safeMaxCommentBodyLength) {
      bestCount = mid;
      bestBody = candidateBody;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestBody === '') {
    bestBody = createMinimalCommentBody(options.truncationUrl);
  }

  return {
    body: bestBody,
    renderedActionsCount: bestCount,
    truncated: true,
  };
}

export function formatComment(
  originalActions: readonly string[],
  expandedActions: readonly string[],
  options: FormatOptions = {},
): string {
  return formatCommentResult(originalActions, expandedActions, options).body;
}
