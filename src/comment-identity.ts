export const COMMENT_MARKER_VERSION = 1;
export const CURRENT_COMMENT_MARKER =
  '<!-- expand-aws-iam-wildcards:review-comment:v1 -->';

const COMMENT_MARKER_PATTERN =
  /^<!-- expand-aws-iam-wildcards:review-comment:v([1-9][0-9]*) -->$/;

export function getCommentMarkerVersion(body: string): number | null {
  const versions = body
    .split(/\r?\n/)
    .map((line) => COMMENT_MARKER_PATTERN.exec(line.trim())?.[1])
    .filter((version): version is string => version !== undefined)
    .map(Number)
    .filter(Number.isSafeInteger);

  return versions.length === 1 ? versions[0] ?? null : null;
}

export function hasCurrentCommentMarker(body: string): boolean {
  return getCommentMarkerVersion(body) === COMMENT_MARKER_VERSION;
}

export function withCurrentCommentMarker(body: string): string {
  return hasCurrentCommentMarker(body)
    ? body
    : `${body}\n\n${CURRENT_COMMENT_MARKER}`;
}
