export const DEFAULT_COLLAPSE_THRESHOLD = 5;

export function parseCollapseThreshold(rawInput: string | undefined): number {
  const normalizedInput = rawInput?.trim();

  if (!normalizedInput) {
    return DEFAULT_COLLAPSE_THRESHOLD;
  }

  if (!/^\d+$/.test(normalizedInput)) {
    throw new Error(
      `Invalid collapse-threshold input: "${rawInput}". Expected a non-negative integer.`,
    );
  }

  const value = Number.parseInt(normalizedInput, 10);

  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `Invalid collapse-threshold input: "${rawInput}". Expected a non-negative integer.`,
    );
  }

  return value;
}
