import minimatch from 'minimatch';

export function matchesPatterns(filename: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(filename, pattern));
}
