import { describe, expect, it } from 'vitest';

import {
  COMMENT_MARKER_VERSION,
  CURRENT_COMMENT_MARKER,
  getCommentMarkerVersion,
  hasCurrentCommentMarker,
  withCurrentCommentMarker,
} from './comment-identity.js';

describe('comment marker identity', () => {
  it('keeps the current marker and version stable', () => {
    expect(COMMENT_MARKER_VERSION).toBe(1);
    expect(CURRENT_COMMENT_MARKER).toBe(
      '<!-- expand-aws-iam-wildcards:review-comment:v1 -->',
    );
  });

  it('recognizes one marker on its own line', () => {
    expect(getCommentMarkerVersion(`visible body\n\n${CURRENT_COMMENT_MARKER}`)).toBe(1);
    expect(getCommentMarkerVersion(
      `visible body\r\n  ${CURRENT_COMMENT_MARKER}  \r\n`,
    )).toBe(1);
    expect(hasCurrentCommentMarker(CURRENT_COMMENT_MARKER)).toBe(true);
  });

  it('recognizes future versions without treating them as current', () => {
    const futureMarker = '<!-- expand-aws-iam-wildcards:review-comment:v2 -->';

    expect(getCommentMarkerVersion(futureMarker)).toBe(2);
    expect(hasCurrentCommentMarker(futureMarker)).toBe(false);
  });

  it.each([
    '**IAM Wildcard Expansion**',
    `text ${CURRENT_COMMENT_MARKER}`,
    `prefix${CURRENT_COMMENT_MARKER}`,
    '<!-- another-action:review-comment:v1 -->',
    '<!-- expand-aws-iam-wildcards:review-comment:v0 -->',
    '<!-- expand-aws-iam-wildcards:review-comment:v01 -->',
    '<!-- expand-aws-iam-wildcards:review-comment:v999999999999999999999 -->',
  ])('rejects a marker collision or malformed marker in %j', (body) => {
    expect(getCommentMarkerVersion(body)).toBeNull();
    expect(hasCurrentCommentMarker(body)).toBe(false);
  });

  it('rejects ambiguous bodies with multiple markers', () => {
    expect(getCommentMarkerVersion(
      `${CURRENT_COMMENT_MARKER}\n${CURRENT_COMMENT_MARKER}`,
    )).toBeNull();
  });

  it('appends the marker once without changing visible content', () => {
    const body = '**IAM Wildcard Expansion**\n\nVisible content.';
    const markedBody = withCurrentCommentMarker(body);

    expect(markedBody).toBe(`${body}\n\n${CURRENT_COMMENT_MARKER}`);
    expect(withCurrentCommentMarker(markedBody)).toBe(markedBody);
  });
});
