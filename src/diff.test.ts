import { describe, it, expect } from 'vitest';
import { parseHunkHeader, extractFromDiff } from './diff.js';

describe('parseHunkHeader', () => {
  it('parses simple hunk header', () => {
    expect(parseHunkHeader('@@ -1,5 +1,7 @@')).toBe(1);
  });

  it('parses hunk header with different line numbers', () => {
    expect(parseHunkHeader('@@ -10,3 +15,8 @@')).toBe(15);
  });

  it('parses hunk header with function context', () => {
    expect(parseHunkHeader('@@ -10,3 +15,8 @@ function foo()')).toBe(15);
  });

  it('parses hunk header without count', () => {
    expect(parseHunkHeader('@@ -1 +1 @@')).toBe(1);
  });

  it('returns null for non-hunk lines', () => {
    expect(parseHunkHeader('+ added line')).toBeNull();
    expect(parseHunkHeader('- removed line')).toBeNull();
    expect(parseHunkHeader(' context line')).toBeNull();
    expect(parseHunkHeader('')).toBeNull();
  });
});

describe('extractFromDiff', () => {
  it('extracts wildcards from added lines', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,3 +1,5 @@
 {
+  "Action": "s3:Get*",
   "Resource": "*"
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(1);
    expect(wildcardMatches[0]).toEqual({
      action: 's3:Get*',
      line: 2,
      file: 'policy.json',
    });
  });

  it('ignores removed lines', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,3 +1,3 @@
 {
-  "Action": "s3:Get*",
+  "Action": "s3:GetObject",
   "Resource": "*"
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(0);
  });

  it('handles multiple files', () => {
    const files = [
      {
        filename: 'policy1.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": "s3:Get*"
 }`,
      },
      {
        filename: 'policy2.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": "ec2:Describe*"
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(2);
    expect(wildcardMatches[0]?.file).toBe('policy1.json');
    expect(wildcardMatches[1]?.file).toBe('policy2.json');
  });

  it('handles files without patches', () => {
    const files = [
      { filename: 'binary.png' },
      {
        filename: 'policy.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": "s3:Get*"
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(1);
    expect(wildcardMatches[0]?.file).toBe('policy.json');
  });

  it('tracks line numbers across multiple hunks', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,3 +1,4 @@
 {
+  "Action": "s3:Get*",
   "Resource": "*"
 }
@@ -10,3 +11,4 @@
 {
+  "Action": "ec2:Describe*",
   "Resource": "*"
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(2);
    expect(wildcardMatches[0]).toEqual({
      action: 's3:Get*',
      line: 2,
      file: 'policy.json',
    });
    expect(wildcardMatches[1]).toEqual({
      action: 'ec2:Describe*',
      line: 12,
      file: 'policy.json',
    });
  });

  it('handles multiple wildcards on same line', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": ["s3:Get*", "s3:Put*"]
 }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(2);
    expect(wildcardMatches[0]?.action).toBe('s3:Get*');
    expect(wildcardMatches[1]?.action).toBe('s3:Put*');
    expect(wildcardMatches[0]?.line).toBe(wildcardMatches[1]?.line);
  });

  it('extracts explicit actions', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,3 +1,5 @@
 {
+  "Action": ["s3:Get*", "s3:GetObject"],
   "Resource": "*"
 }`,
      },
    ];

    const { wildcardMatches, explicitActions } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(1);
    expect(wildcardMatches[0]?.action).toBe('s3:Get*');
    expect(explicitActions).toContain('s3:GetObject');
  });
});
