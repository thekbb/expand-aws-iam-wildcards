import { Buffer } from 'node:buffer';

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

function decodeGitPath(value: string): string | null {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) return null;

  const bytes: number[] = [];
  const escapedCharacters: Readonly<Record<string, string>> = {
    a: '\u0007',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\u000b',
    '\\': '\\',
    '"': '"',
  };

  for (let index = 1; index < value.length - 1; index++) {
    const character = value.charAt(index);
    if (character !== '\\') {
      bytes.push(...Buffer.from(character));
      continue;
    }

    const escape = value.charAt(++index);

    if (/^[0-7]$/.test(escape)) {
      let octal = escape;
      while (octal.length < 3 && /^[0-7]$/.test(value.charAt(index + 1))) {
        octal += value[++index];
      }
      bytes.push(parseInt(octal, 8));
      continue;
    }

    const decoded = escapedCharacters[escape];
    if (decoded === undefined) return null;
    bytes.push(...Buffer.from(decoded));
  }

  return Buffer.from(bytes).toString('utf8');
}

function getDiffHeaderFilename(line: string): string | null {
  const encodedPath = line.slice(4);
  const path = decodeGitPath(encodedPath);
  if (path === null || path === '/dev/null') return null;
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : null;
}

function findClosingQuote(value: string, start: number): number | null {
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] === '\\') {
      index++;
    } else if (value[index] === '"') {
      return index;
    }
  }
  return null;
}

function getDiffGitFilename(line: string): string | null {
  const paths = line.slice('diff --git '.length);
  let currentPath: string;

  if (paths.startsWith('"')) {
    const previousPathEnd = findClosingQuote(paths, 0);
    if (previousPathEnd === null) return null;
    currentPath = paths.slice(previousPathEnd + 1).trimStart();
  } else {
    const currentPathStart = paths.lastIndexOf(' b/');
    if (currentPathStart < 0) return null;
    currentPath = paths.slice(currentPathStart + 1);
  }

  const decodedPath = decodeGitPath(currentPath);
  return decodedPath?.startsWith('b/') ? decodedPath.slice(2) : null;
}

function isCompleteHunkPatch(lines: readonly string[]): boolean {
  let oldLinesRemaining = 0;
  let newLinesRemaining = 0;
  let hasHunk = false;

  for (const line of lines) {
    const header = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (header) {
      if (hasHunk && (oldLinesRemaining !== 0 || newLinesRemaining !== 0)) return false;
      oldLinesRemaining = parseInt(header[1] ?? '1', 10);
      newLinesRemaining = parseInt(header[2] ?? '1', 10);
      hasHunk = true;
      continue;
    }

    if (!hasHunk || isNoNewlineMarker(line)) continue;
    if (line.startsWith(' ')) {
      oldLinesRemaining--;
      newLinesRemaining--;
    } else if (line.startsWith('-')) {
      oldLinesRemaining--;
    } else if (line.startsWith('+')) {
      newLinesRemaining--;
    } else {
      return false;
    }

    if (oldLinesRemaining < 0 || newLinesRemaining < 0) return false;
  }

  return hasHunk && oldLinesRemaining === 0 && newLinesRemaining === 0;
}

function getFilePatchFromSection(lines: readonly string[]): string | null {
  const hunkIndex = lines.findIndex((line) => line.startsWith('@@'));
  if (hunkIndex >= 0) {
    const patchLines = lines.slice(hunkIndex);
    if (patchLines.at(-1) === '') patchLines.pop();
    return isCompleteHunkPatch(patchLines) ? patchLines.join('\n') : null;
  }

  const binaryLines = lines.filter((line) =>
    line === 'GIT binary patch' || /^Binary files .+ differ$/.test(line),
  );
  if (binaryLines.length > 0) return binaryLines.join('\n');

  const hasKnownEmptyBlob = lines.some((line) =>
    /^index (?:0+\.\.e69de29[0-9a-f]*|e69de29[0-9a-f]*\.\.0+)(?: |$)/.test(line)
  );
  const isExactRename = lines.includes('similarity index 100%');
  const isKnownContentFreeChange = hasKnownEmptyBlob || isExactRename;
  return isKnownContentFreeChange ? '' : null;
}

function parsePullRequestDiff(diff: string): ReadonlyMap<string, string> {
  const sections: string[][] = [];
  let currentSection: string[] | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      currentSection = [line];
      sections.push(currentSection);
    } else {
      currentSection?.push(line);
    }
  }

  const patches = new Map<string, string>();
  for (const section of sections) {
    const [diffHeader] = section as [string, ...string[]];
    const currentPathLine = section.find((line) => line.startsWith('+++ '));
    const previousPathLine = section.find((line) => line.startsWith('--- '));
    const currentFilename = currentPathLine === undefined
      ? null
      : getDiffHeaderFilename(currentPathLine);
    const previousFilename = previousPathLine === undefined
      ? null
      : getDiffHeaderFilename(previousPathLine);
    const filename = currentFilename ?? previousFilename ?? getDiffGitFilename(diffHeader);
    const patch = getFilePatchFromSection(section);
    if (filename !== null && patch !== null) patches.set(filename, patch);
  }

  return patches;
}

export function recoverFilePatchesFromDiff(
  files: readonly PullRequestFile[],
  diff: string,
): PullRequestFile[] {
  const patches = parsePullRequestDiff(diff);
  return files.map((file) => {
    const state = analyzeFile(file).state;
    if (state !== 'missing-patch' && state !== 'failed') return file;
    const patch = patches.get(file.filename);
    return patch === undefined ? file : { ...file, patch };
  });
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
