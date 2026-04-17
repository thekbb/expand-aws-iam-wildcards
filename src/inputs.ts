export const DEFAULT_COLLAPSE_THRESHOLD = 5;
const COLLAPSE_THRESHOLD_ERROR_SUFFIX =
  'Expected a non-negative safe integer.';

function createCollapseThresholdError(rawInput: string | undefined): Error {
  return new Error(
    `Invalid collapse-threshold input: "${rawInput}". ${COLLAPSE_THRESHOLD_ERROR_SUFFIX}`,
  );
}

export function parseCollapseThreshold(rawInput: string | undefined): number {
  const normalizedInput = rawInput?.trim();

  if (!normalizedInput) {
    return DEFAULT_COLLAPSE_THRESHOLD;
  }

  if (!/^\d+$/.test(normalizedInput)) {
    throw createCollapseThresholdError(rawInput);
  }

  const value = Number.parseInt(normalizedInput, 10);

  if (!Number.isSafeInteger(value)) {
    throw createCollapseThresholdError(rawInput);
  }

  return value;
}
