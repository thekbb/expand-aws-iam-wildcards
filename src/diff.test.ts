import { describe, expect, it } from 'vitest';

import { extractFromDiff, parseHunkHeader, recoverFilePatchesFromDiff } from './diff.js';

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

  it('analyzes renamed and removed text files without scanning removed lines', () => {
    const result = extractFromDiff([
      {
        filename: 'renamed-policy.tf',
        patch: '@@ -1 +1 @@\n-"s3:GetObject"\n+"s3:Get*"',
      },
      {
        filename: 'removed-policy.tf',
        patch: '@@ -1 +0,0 @@\n-"ec2:Describe*"',
      },
    ]);

    expect(result.files.map((file) => [file.filename, file.state])).toEqual([
      ['renamed-policy.tf', 'analyzed'],
      ['removed-policy.tf', 'analyzed'],
    ]);
    expect(result.wildcardMatches).toEqual([
      { action: 's3:Get*', line: 1, file: 'renamed-policy.tf' },
    ]);
    expect(result.counts.analyzed).toBe(2);
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

  it('reports files without patch text as missing instead of silently skipping them', () => {
    const files = [
      { filename: 'large-policy.json' },
      {
        filename: 'policy.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": "s3:Get*"
 }`,
      },
    ];

    const result = extractFromDiff(files);

    expect(result.wildcardMatches).toHaveLength(1);
    expect(result.wildcardMatches[0]?.file).toBe('policy.json');
    expect(result.files).toEqual([
      { filename: 'large-policy.json', state: 'missing-patch', wildcardMatches: [] },
      {
        filename: 'policy.json',
        state: 'analyzed',
        wildcardMatches: result.wildcardMatches,
      },
    ]);
    expect(result.counts).toEqual({
      analyzed: 1,
      binary: 0,
      empty: 0,
      missingPatch: 1,
      failed: 0,
    });
  });

  it.each([
    'Binary files a/image.png and b/image.png differ',
    'GIT binary patch\nliteral 0',
  ])('reports an explicit binary patch without analyzing %j', (patch) => {
    const result = extractFromDiff([{ filename: 'image.png', patch }]);

    expect(result.files).toEqual([
      { filename: 'image.png', state: 'binary', wildcardMatches: [] },
    ]);
    expect(result.counts.binary).toBe(1);
    expect(result.wildcardMatches).toEqual([]);
  });

  it('reports malformed nonempty patch text as failed analysis', () => {
    const result = extractFromDiff([{
      filename: 'policy.tf',
      patch: '+ "s3:Get*"',
    }]);

    expect(result.files).toEqual([
      { filename: 'policy.tf', state: 'failed', wildcardMatches: [] },
    ]);
    expect(result.counts.failed).toBe(1);
    expect(result.wildcardMatches).toEqual([]);
  });

  it('discards partial matches when a later hunk header is malformed', () => {
    const result = extractFromDiff([{
      filename: 'policy.tf',
      patch: '@@ -1 +1 @@\n+"s3:Get*"\n@@ malformed @@\n+"ec2:Describe*"',
    }]);

    expect(result.files).toEqual([
      { filename: 'policy.tf', state: 'failed', wildcardMatches: [] },
    ]);
    expect(result.wildcardMatches).toEqual([]);
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

  it('handles multiple wildcards on the same line', () => {
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

  it('extracts wildcards from Terraform policy diffs with multiple added actions', () => {
    const files = [
      {
        filename: 'policy.tf',
        patch: `@@ -22,10 +22,12 @@
       {
         Effect = "Allow"
         Action = [
+          "dynamodb:Get*",
+          "dynamodb:List*",
           "dynamodb:Query",
           "dynamodb:Scan",
         ]
         Resource = "*"
       }`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(2);
    expect(wildcardMatches.map((match) => match.action).sort()).toEqual([
      'dynamodb:Get*',
      'dynamodb:List*',
    ]);
    expect(wildcardMatches[0]?.file).toBe('policy.tf');
    expect(wildcardMatches[1]?.file).toBe('policy.tf');
  });

  it('reports empty string patches while retaining other file results', () => {
    const files = [
      { filename: 'policy.tf', patch: '' },
      {
        filename: 'policy.json',
        patch: `@@ -1,2 +1,2 @@
+  "Action": "s3:Get*"
 }`,
      },
    ];

    const result = extractFromDiff(files);

    expect(result.wildcardMatches).toHaveLength(1);
    expect(result.wildcardMatches[0]?.action).toBe('s3:Get*');
    expect(result.files[0]).toEqual({
      filename: 'policy.tf',
      state: 'empty',
      wildcardMatches: [],
    });
    expect(result.counts.empty).toBe(1);
  });

  it('does not count the no-newline marker as a destination line', () => {
    const files = [
      {
        filename: 'policy.json',
        patch: `@@ -1,1 +1,1 @@
-  "Action": "s3:GetObject"
+  "Action": "s3:Get*"
\\ No newline at end of file
@@ -10,2 +10,3 @@
 {
+  "Action": "ec2:Describe*"
 }
}`,
      },
    ];

    const { wildcardMatches } = extractFromDiff(files);

    expect(wildcardMatches).toHaveLength(2);
    expect(wildcardMatches[0]).toEqual({
      action: 's3:Get*',
      line: 1,
      file: 'policy.json',
    });
    expect(wildcardMatches[1]).toEqual({
      action: 'ec2:Describe*',
      line: 11,
      file: 'policy.json',
    });
  });
});

describe('recoverFilePatchesFromDiff', () => {
  it('recovers missing and failed text patches without replacing analyzed patches', () => {
    const analyzedPatch = '@@ -1 +1 @@\n+"s3:Get*"';
    const files = [
      { filename: 'missing.tf' },
      { filename: 'failed.tf', patch: '+"malformed"' },
      { filename: 'analyzed.tf', patch: analyzedPatch },
      { filename: 'removed.tf' },
    ];
    const diff = `diff --git a/missing.tf b/missing.tf
--- a/missing.tf
+++ b/missing.tf
@@ -1 +1 @@
-"s3:GetObject"
+"s3:Get*"
@@ -10 +10 @@
-"lambda:GetFunction"
+"lambda:Get*"
diff --git a/failed.tf b/failed.tf
--- a/failed.tf
+++ b/failed.tf
@@ -1 +1 @@
-"ec2:DescribeInstances"
+"ec2:Describe*"
diff --git a/analyzed.tf b/analyzed.tf
--- a/analyzed.tf
+++ b/analyzed.tf
@@ -1 +1 @@
-"s3:GetObject"
+"s3:Put*"
diff --git a/removed.tf b/removed.tf
deleted file mode 100644
--- a/removed.tf
+++ /dev/null
@@ -1 +0,0 @@
-"s3:Get*"
`;

    const recovered = recoverFilePatchesFromDiff(files, diff);
    const result = extractFromDiff(recovered);

    expect(result.counts).toEqual({
      analyzed: 4,
      binary: 0,
      empty: 0,
      missingPatch: 0,
      failed: 0,
    });
    expect(result.wildcardMatches.map((match) => match.action)).toEqual([
      's3:Get*',
      'lambda:Get*',
      'ec2:Describe*',
      's3:Get*',
    ]);
    expect(recovered[2]?.patch).toBe(analyzedPatch);
  });

  it('recovers explicit binary and empty file states from sections without hunks', () => {
    const files = [
      { filename: 'image.png' },
      { filename: 'empty file.tf' },
      { filename: 'renamed.tf' },
    ];
    const diff = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..1234567
Binary files /dev/null and b/image.png differ
diff --git a/empty file.tf b/empty file.tf
new file mode 100644
index 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
diff --git a/old.tf b/renamed.tf
similarity index 100%
rename from old.tf
rename to renamed.tf`;

    const result = extractFromDiff(recoverFilePatchesFromDiff(files, diff));

    expect(result.files.map((file) => [file.filename, file.state])).toEqual([
      ['image.png', 'binary'],
      ['empty file.tf', 'empty'],
      ['renamed.tf', 'empty'],
    ]);
  });

  it('recovers C-quoted Git paths with escaped and UTF-8 octal characters', () => {
    const filename = 'policy\té.tf';
    const encodedFilename = 'policy\\t\\303\\251.tf';
    const diff = `diff --git "a/${encodedFilename}" "b/${encodedFilename}"
--- "a/${encodedFilename}"
+++ "b/${encodedFilename}"
@@ -1 +1 @@
-"s3:GetObject"
+"s3:Get*"`;

    const recovered = recoverFilePatchesFromDiff([{ filename }], diff);

    expect(extractFromDiff(recovered).wildcardMatches).toEqual([
      { action: 's3:Get*', line: 1, file: filename },
    ]);
  });

  it.each([
    'diff --git "a/policy.tf" "b/policy.tf',
    'diff --git "a/policy\\q.tf" "b/policy\\q.tf"\n--- "a/policy\\q.tf"\n+++ "b/policy\\q.tf"',
  ])('rejects a malformed quoted Git path in %j', (diff) => {
    const result = extractFromDiff(
      recoverFilePatchesFromDiff([{ filename: 'policy.tf' }], diff),
    );

    expect(result.counts.missingPatch).toBe(1);
  });

  it('leaves unmatched files missing when a large full diff is incomplete', () => {
    const files = [{ filename: 'not-in-diff.tf' }];

    const recovered = recoverFilePatchesFromDiff(
      files,
      'diff --git a/other.tf b/other.tf\n--- a/other.tf\n+++ b/other.tf\n@@ -1 +1 @@\n-old\n+new',
    );

    expect(recovered).toEqual(files);
    expect(extractFromDiff(recovered).counts.missingPatch).toBe(1);
  });

  it('leaves a matched no-hunk section missing when the full diff is truncated', () => {
    const files = [{ filename: 'policy.tf' }];
    const diff = `diff --git a/policy.tf b/policy.tf
index 1234567..7654321 100644
--- a/policy.tf
+++ b/policy.tf`;

    const recovered = recoverFilePatchesFromDiff(files, diff);

    expect(recovered).toEqual(files);
    expect(extractFromDiff(recovered).counts.missingPatch).toBe(1);
  });

  it('leaves a matched partial hunk missing when the full diff is truncated', () => {
    const files = [{ filename: 'policy.tf' }];
    const diff = `diff --git a/policy.tf b/policy.tf
--- a/policy.tf
+++ b/policy.tf
@@ -1,3 +1,3 @@
-"s3:GetObject"
+"s3:Get*"`;

    const recovered = recoverFilePatchesFromDiff(files, diff);

    expect(recovered).toEqual(files);
    expect(extractFromDiff(recovered).counts.missingPatch).toBe(1);
  });
});
