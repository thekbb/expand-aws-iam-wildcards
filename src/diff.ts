import type { PullRequestFile, WildcardMatch } from './types.js';
import { findPotentialWildcardActions } from './utils.js';

export type DiffAnalysisState =
  | 'analyzed'
  | 'binary'
  | 'empty'
  | 'missing-patch'
  | 'failed';

export interface FileDiffAnalysis {
  readonly filename: string;
  readonly state: DiffAnalysisState;
  readonly wildcardMatches: readonly WildcardMatch[];
}

export interface DiffAnalysisCounts {
  readonly analyzed: number;
  readonly binary: number;
  readonly empty: number;
  readonly missingPatch: number;
  readonly failed: number;
}

export interface DiffResults {
  readonly wildcardMatches: WildcardMatch[];
  readonly files: readonly FileDiffAnalysis[];
  readonly counts: DiffAnalysisCounts;
}

interface PatchExtractionResult {
  readonly wildcardMatches: WildcardMatch[];
  readonly hasHunk: boolean;
  readonly failed: boolean;
}

function isNoNewlineMarker(line: string): boolean {
  return line === '\\ No newline at end of file';
}

function isExplicitBinaryPatch(patch: string): boolean {
  return patch.split('\n').some((line) =>
    line === 'GIT binary patch' || /^Binary files .+ differ$/.test(line),
  );
}

function extractFromPatch(patch: string, filename: string): PatchExtractionResult {
  const wildcardMatches: WildcardMatch[] = [];
  let currentLine = 0;
  let hasHunk = false;
  let failed = false;

  for (const line of patch.split('\n')) {
    const hunkStart = parseHunkHeader(line);
    if (hunkStart !== null) {
      currentLine = hunkStart - 1;
      hasHunk = true;
      continue;
    }

    if (line.startsWith('@@')) {
      failed = true;
      continue;
    }

    if (isNoNewlineMarker(line)) continue;
    if (!hasHunk || line.startsWith('-')) continue;

    currentLine++;

    if (line.startsWith('+')) {
      for (const action of findPotentialWildcardActions(line)) {
        wildcardMatches.push({ action, line: currentLine, file: filename });
      }
    }
  }

  return { wildcardMatches, hasHunk, failed };
}

function analyzeFile(file: PullRequestFile): FileDiffAnalysis {
  if (file.patch === undefined) {
    return { filename: file.filename, state: 'missing-patch', wildcardMatches: [] };
  }

  if (file.patch.length === 0) {
    return { filename: file.filename, state: 'empty', wildcardMatches: [] };
  }

  if (isExplicitBinaryPatch(file.patch)) {
    return { filename: file.filename, state: 'binary', wildcardMatches: [] };
  }

  const result = extractFromPatch(file.patch, file.filename);
  return result.hasHunk && !result.failed
    ? { filename: file.filename, state: 'analyzed', wildcardMatches: result.wildcardMatches }
    : { filename: file.filename, state: 'failed', wildcardMatches: [] };
}

function countAnalyses(files: readonly FileDiffAnalysis[]): DiffAnalysisCounts {
  const counts = {
    analyzed: 0,
    binary: 0,
    empty: 0,
    missingPatch: 0,
    failed: 0,
  };

  for (const file of files) {
    switch (file.state) {
      case 'analyzed':
        counts.analyzed += 1;
        break;
      case 'binary':
        counts.binary += 1;
        break;
      case 'empty':
        counts.empty += 1;
        break;
      case 'missing-patch':
        counts.missingPatch += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
    }
  }

  return counts;
}

export function parseHunkHeader(line: string): number | null {
  const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

export function extractFromDiff(files: readonly PullRequestFile[]): DiffResults {
  const analyses = files.map(analyzeFile);
  return {
    wildcardMatches: analyses.flatMap((file) => file.wildcardMatches),
    files: analyses,
    counts: countAnalyses(analyses),
  };
}
