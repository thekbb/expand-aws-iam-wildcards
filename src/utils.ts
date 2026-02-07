import type { WildcardMatch, WildcardBlock } from './types.js';
import { formatActionWithLink } from './docs.js';

const IAM_WILDCARD_PATTERN = /["']?([a-zA-Z0-9-]+:[a-zA-Z0-9*?]*\*[a-zA-Z0-9*?]*)["']?/g;
const IAM_EXPLICIT_PATTERN = /["']([a-zA-Z0-9-]+:[a-zA-Z][a-zA-Z0-9]*)["']/g;

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
}

export function formatComment(
  originalActions: readonly string[],
  expandedActions: readonly string[],
  options: FormatOptions = {},
): string {
  const { collapseThreshold = 5, redundantActions } = options;

  const header = originalActions.length === 1
    ? `\`${originalActions[0]}\` expands to ${expandedActions.length} action(s):`
    : `${originalActions.length} wildcard patterns expand to ${expandedActions.length} action(s):`;

  const patterns = originalActions.length > 1
    ? `\n**Patterns:**\n${originalActions.map((a) => `- \`${a}\``).join('\n')}`
    : '';

  const warning = redundantActions && redundantActions.length > 0
    ? `\n\n**⚠️ Redundant actions detected:**\nThe following explicit actions are already covered by the wildcard pattern(s) above:\n${redundantActions.map((a) => `- \`${a}\``).join('\n')}`
    : '';

  const actionsList = expandedActions.map((a) => `1. ${formatActionWithLink(a)}`).join('\n');

  const actionsBlock = expandedActions.length > collapseThreshold
    ? `<details>
<summary>Click to expand</summary>

${actionsList}

</details>`
    : actionsList;

  return `**IAM Wildcard Expansion**

${header}${patterns}${warning}

${actionsBlock}`;
}
