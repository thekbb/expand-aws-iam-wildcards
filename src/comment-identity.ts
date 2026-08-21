export const COMMENT_MARKER_VERSION = 1;
export const CURRENT_COMMENT_MARKER =
  '<!-- expand-aws-iam-wildcards:review-comment:v1 -->';
export const LEGACY_COMMENT_HEADING = '**IAM Wildcard Expansion**';

const COMMENT_MARKER_NAMESPACE = 'expand-aws-iam-wildcards:review-comment:';
const COMMENT_MARKER_PATTERN =
  /^<!-- expand-aws-iam-wildcards:review-comment:v([1-9][0-9]*) -->$/;

type CommentMarkerState =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly version: number };

function getCommentMarkerState(body: string): CommentMarkerState {
  const markerLines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(COMMENT_MARKER_NAMESPACE));

  if (markerLines.length === 0) return { kind: 'none' };
  if (markerLines.length !== 1) return { kind: 'invalid' };

  const match = COMMENT_MARKER_PATTERN.exec(markerLines.join(''));
  const version = Number(match?.[1]);
  return match && Number.isSafeInteger(version)
    ? { kind: 'valid', version }
    : { kind: 'invalid' };
}

export function getCommentMarkerVersion(body: string): number | null {
  const marker = getCommentMarkerState(body);
  return marker.kind === 'valid' ? marker.version : null;
}

export function hasLegacyCommentShape(body: string): boolean {
  if (getCommentMarkerState(body).kind !== 'none') return false;

  const normalizedBody = body.replaceAll('\r\n', '\n');
  const content = normalizedBody.slice(`${LEGACY_COMMENT_HEADING}\n\n`.length);
  if (!normalizedBody.startsWith(`${LEGACY_COMMENT_HEADING}\n\n`)) return false;

  return /^`[^`\n]+` expands to [1-9][0-9]* action\(s\):(?:\n|$)/.test(content)
    || /^[1-9][0-9]* wildcard patterns expand to [1-9][0-9]* action\(s\):(?:\n|$)/.test(content)
    || content === 'Expanded actions were omitted from this comment to stay within GitHub limits.'
    || /^Expanded actions were omitted from this comment to stay within GitHub limits\. The full expanded list is in the \[workflow run logs\]\([^)\n]+\)\.$/.test(content);
}

export function hasCurrentCommentMarker(body: string): boolean {
  return getCommentMarkerVersion(body) === COMMENT_MARKER_VERSION;
}

export function withCurrentCommentMarker(body: string): string {
  return hasCurrentCommentMarker(body)
    ? body
    : `${body}\n\n${CURRENT_COMMENT_MARKER}`;
}
