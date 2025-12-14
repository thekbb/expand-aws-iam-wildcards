import type { PullRequestFile, WildcardMatch } from './types.js';
import { findPotentialWildcardActions, findExplicitActions } from './utils.js';

export interface DiffResults {
  readonly wildcardMatches: WildcardMatch[];
  readonly explicitActions: string[];
}

export function parseHunkHeader(line: string): number | null {
  const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

export function extractFromDiff(files: readonly PullRequestFile[]): DiffResults {
  const wildcardMatches: WildcardMatch[] = [];
  const explicitActions: string[] = [];

  for (const file of files) {
    if (!file.patch) continue;

    let currentLine = 0;

    for (const line of file.patch.split('\n')) {
      const hunkStart = parseHunkHeader(line);
      if (hunkStart !== null) {
        currentLine = hunkStart - 1;
        continue;
      }

      if (line.startsWith('-')) continue;

      currentLine++;

      if (line.startsWith('+')) {
        for (const action of findPotentialWildcardActions(line)) {
          wildcardMatches.push({ action, line: currentLine, file: file.filename });
        }
        for (const action of findExplicitActions(line)) {
          explicitActions.push(action);
        }
      }
    }
  }

  return { wildcardMatches, explicitActions };
}
