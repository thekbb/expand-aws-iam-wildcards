import { describe, it, expect } from 'vitest';
import {
  COMMENT_MARKER,
  expandWildcards,
  findDuplicateWildcardActions,
  findRedundantActions,
  createReviewComments,
  processFiles,
} from './action.js';
import type { ExplicitActionMatch, PullRequestFile, WildcardBlock, WildcardMatch } from './types.js';

describe('COMMENT_MARKER', () => {
  it('contains the expected marker text', () => {
    expect(COMMENT_MARKER).toBe('**IAM Wildcard Expansion**');
  });
});

describe('expandWildcards', () => {
  it('expands valid wildcard actions', () => {
    const result = expandWildcards(['s3:Get*']);
    expect(result.size).toBeGreaterThan(0);
    expect(result.has('s3:Get*')).toBe(true);
    const expanded = result.get('s3:Get*') ?? [];
    expect(expanded.length).toBeGreaterThan(1);
  });

  it('does not include actions that do not expand', () => {
    const result = expandWildcards(['s3:GetObject']);
    expect(result.has('s3:GetObject')).toBe(false);
  });

  it('handles unknown service prefixes gracefully', () => {
    const result = expandWildcards(['unknownservice:*']);
    expect(result.has('unknownservice:*')).toBe(false);
  });

  it('expands multiple wildcards', () => {
    const result = expandWildcards(['s3:Get*', 'ec2:Describe*']);
    expect(result.size).toBe(2);
    expect(result.has('s3:Get*')).toBe(true);
    expect(result.has('ec2:Describe*')).toBe(true);
  });
});

describe('findRedundantActions', () => {
  it('finds explicit actions covered by wildcards', () => {
    const result = findRedundantActions(
      ['s3:GetObject', 's3:PutObject'],
      ['s3:getobject', 's3:getbucket'],
    );
    expect(result).toEqual(['s3:GetObject']);
  });

  it('is case-insensitive', () => {
    const result = findRedundantActions(['S3:GETOBJECT'], ['s3:getobject']);
    expect(result).toEqual(['S3:GETOBJECT']);
  });

  it('returns empty array when no redundant actions', () => {
    const result = findRedundantActions(['s3:PutObject'], ['s3:getobject']);
    expect(result).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(findRedundantActions([], [])).toEqual([]);
    expect(findRedundantActions(['s3:GetObject'], [])).toEqual([]);
  });

  it('deduplicates redundant actions while preserving the first casing', () => {
    const result = findRedundantActions(
      ['S3:GetObject', 's3:getobject'],
      ['s3:getobject'],
    );

    expect(result).toEqual(['S3:GetObject']);
  });
});

describe('findDuplicateWildcardActions', () => {
  it('returns wildcard patterns that appear more than once', () => {
    const result = findDuplicateWildcardActions(['ec2:List*', 'ec2:List*', 's3:Get*']);

    expect(result).toEqual(['ec2:List*']);
  });

  it('deduplicates duplicates case-insensitively while preserving first casing', () => {
    const result = findDuplicateWildcardActions(['EC2:List*', 'ec2:list*', 'EC2:LIST*']);

    expect(result).toEqual(['EC2:List*']);
  });
});

describe('createReviewComments', () => {
  it('creates comments for blocks with expanded actions', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:Get*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:Get*' },
    ];
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject', 's3:getbucket']],
    ]);

    const result = createReviewComments(blocks, wildcardMatches, expanded, [], 5);

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('policy.json');
    expect(result[0].line).toBe(10);
    expect(result[0].body).toContain(COMMENT_MARKER);
  });

  it('skips blocks with no expanded actions', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['unknown:Action*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 'unknown:Action*' },
    ];
    const expanded = new Map<string, string[]>();

    const result = createReviewComments(blocks, wildcardMatches, expanded, [], 5);

    expect(result).toHaveLength(0);
  });

  it('deduplicates and sorts expanded actions', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 11,
      actions: ['s3:Get*', 's3:GetB*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:Get*' },
      { file: 'policy.json', line: 11, action: 's3:GetB*' },
    ];
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject', 's3:getbucket']],
      ['s3:GetB*', ['s3:getbucket', 's3:getbucketacl']],
    ]);

    const result = createReviewComments(blocks, wildcardMatches, expanded, [], 10);

    expect(result).toHaveLength(1);
    expect(result[0].body).toContain('s3:getbucket');
    expect(result[0].body).toContain('s3:getbucketacl');
    expect(result[0].body).toContain('s3:getobject');
  });

  it('passes only block-local redundant actions to formatComment', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:Get*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:Get*' },
    ];
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject']],
    ]);
    const explicitActionMatches: ExplicitActionMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:GetObject' },
      { file: 'other.json', line: 10, action: 's3:GetObject' },
    ];

    const result = createReviewComments(blocks, wildcardMatches, expanded, explicitActionMatches, 5);

    expect(result[0].body).toContain('Redundant');
  });

  it('warns when the same wildcard pattern appears multiple times in a block', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 11,
      actions: ['ec2:List*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 'ec2:List*' },
      { file: 'policy.json', line: 11, action: 'ec2:List*' },
    ];
    const expanded = new Map([
      ['ec2:List*', ['ec2:ListImagesInRecycleBin']],
    ]);

    const result = createReviewComments(blocks, wildcardMatches, expanded, [], 5);

    expect(result[0].body).toContain('Duplicate wildcard patterns detected');
    expect(result[0].body).toContain('`ec2:List*`');
  });

  it('respects collapse threshold', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:*' },
    ];
    const manyActions = Array.from({ length: 20 }, (_, i) => `s3:action${i}`);
    const expanded = new Map([['s3:*', manyActions]]);

    const result = createReviewComments(blocks, wildcardMatches, expanded, [], 5);

    expect(result[0].body).toContain('<details>');
  });

  it('truncates oversized comment bodies and links to workflow logs', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:*'],
    }];
    const wildcardMatches: WildcardMatch[] = [
      { file: 'policy.json', line: 10, action: 's3:*' },
    ];
    const manyActions = Array.from({ length: 20 }, (_, i) => `unknown:Action${i}`);
    const expanded = new Map([['s3:*', manyActions]]);

    const result = createReviewComments(
      blocks,
      wildcardMatches,
      expanded,
      [],
      5,
      {
        maxCommentBodyLength: 325,
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/123',
      },
    );

    expect(result[0].body).toContain('workflow run logs');
    expect(result[0].body).toContain('Showing first');
    expect(result[0].body).not.toContain('unknown:Action19');
  });
});

describe('processFiles', () => {
  const makePatch = (lines: string[]) =>
    lines.map((line, i) => `@@ -0,0 +${i + 1} @@\n+${line}`).join('\n');

  it('returns empty result for no matching files', () => {
    const files: PullRequestFile[] = [
      { filename: 'README.md', patch: '+some content' },
    ];

    const result = processFiles(files, ['**/*.tf'], 5);

    expect(result.comments).toEqual([]);
    expect(result.stats.filesScanned).toBe(0);
  });

  it('returns empty result for files with no wildcards', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"s3:GetObject"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toEqual([]);
    expect(result.stats.filesScanned).toBe(1);
    expect(result.stats.wildcardsFound).toBe(0);
  });

  it('returns empty result when wildcards found but none expand', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"unknownservice:Get*"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toEqual([]);
    expect(result.stats.wildcardsFound).toBe(1);
    expect(result.stats.actionsExpanded).toBe(0);
    expect(result.truncatedComments).toEqual([]);
  });

  it('processes files with wildcards and creates comments', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"s3:Get*"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments.length).toBeGreaterThan(0);
    expect(result.stats.wildcardsFound).toBe(1);
    expect(result.stats.actionsExpanded).toBe(1);
  });

  it('filters files by patterns', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"s3:Get*"']) },
      { filename: 'policy.json', patch: makePatch(['"s3:Put*"']) },
    ];

    const result = processFiles(files, ['**/*.tf'], 5);

    expect(result.stats.filesScanned).toBe(1);
  });

  it('detects redundant actions', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"s3:Get*", "s3:GetObject"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.redundantActions).toEqual(['s3:GetObject']);
  });

  it('scopes redundant-action warnings to the specific block', () => {
    const files: PullRequestFile[] = [
      {
        filename: 'policy.tf',
        patch: makePatch([
          '"s3:Get*"',
          '"Statement": "separator"',
          '"ec2:Describe*", "ec2:DescribeInstances"',
        ]),
      },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].body).not.toContain('Redundant');
    expect(result.comments[0].body).not.toContain('ec2:DescribeInstances');
    expect(result.comments[1].body).toContain('Redundant');
    expect(result.comments[1].body).toContain('`ec2:DescribeInstances`');
    expect(result.redundantActions).toEqual(['ec2:DescribeInstances']);
  });

  it('does not leak redundant-action warnings across files', () => {
    const files: PullRequestFile[] = [
      { filename: 'a.tf', patch: makePatch(['"s3:Get*"']) },
      { filename: 'b.tf', patch: makePatch(['"ec2:Describe*", "ec2:DescribeInstances"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toHaveLength(2);
    const s3Comment = result.comments.find((comment) => comment.path === 'a.tf');
    const ec2Comment = result.comments.find((comment) => comment.path === 'b.tf');
    expect(s3Comment?.body).not.toContain('Redundant');
    expect(ec2Comment?.body).toContain('Redundant');
    expect(ec2Comment?.body).toContain('`ec2:DescribeInstances`');
  });

  it('reports duplicate wildcard patterns within a block', () => {
    const files: PullRequestFile[] = [
      {
        filename: 'policy.tf',
        patch: makePatch(['"ec2:List*"', '"ec2:List*"']),
      },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].body).toContain('Duplicate wildcard patterns detected');
    expect(result.comments[0].body).toContain('`ec2:List*`');
  });

  it('scans all files when no patterns provided', () => {
    const files: PullRequestFile[] = [
      { filename: 'a.tf', patch: makePatch(['"s3:Get*"']) },
      { filename: 'b.json', patch: makePatch(['"ec2:Describe*"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.stats.filesScanned).toBe(2);
  });

  it('handles files without patches', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf' },
    ];

    const result = processFiles(files, [], 5);

    expect(result.comments).toEqual([]);
    expect(result.stats.filesScanned).toBe(1);
  });

  it('returns truncated comment metadata when a comment body is trimmed', () => {
    const files: PullRequestFile[] = [
      { filename: 'policy.tf', patch: makePatch(['"s3:*"']) },
    ];

    const result = processFiles(
      files,
      [],
      5,
      {
        maxCommentBodyLength: 325,
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/123',
      },
    );

    expect(result.comments).toHaveLength(1);
    expect(result.truncatedComments).toHaveLength(1);
    expect(result.truncatedComments[0].file).toBe('policy.tf');
    expect(result.comments[0].body).toContain('workflow run logs');
  });
});
