import { describe, it, expect } from 'vitest';
import {
  COMMENT_MARKER,
  expandWildcards,
  findRedundantActions,
  createReviewComments,
  processFiles,
} from './action.js';
import type { PullRequestFile, WildcardBlock } from './types.js';

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
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject', 's3:getbucket']],
    ]);
    const result = findRedundantActions(['s3:GetObject', 's3:PutObject'], expanded);
    expect(result).toEqual(['s3:GetObject']);
  });

  it('is case-insensitive', () => {
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject']],
    ]);
    const result = findRedundantActions(['S3:GETOBJECT'], expanded);
    expect(result).toEqual(['S3:GETOBJECT']);
  });

  it('returns empty array when no redundant actions', () => {
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject']],
    ]);
    const result = findRedundantActions(['s3:PutObject'], expanded);
    expect(result).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(findRedundantActions([], new Map())).toEqual([]);
    expect(findRedundantActions(['s3:GetObject'], new Map())).toEqual([]);
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
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject', 's3:getbucket']],
    ]);

    const result = createReviewComments(blocks, expanded, [], 5);

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
    const expanded = new Map<string, string[]>();

    const result = createReviewComments(blocks, expanded, [], 5);

    expect(result).toHaveLength(0);
  });

  it('deduplicates and sorts expanded actions', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 11,
      actions: ['s3:Get*', 's3:GetB*'],
    }];
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject', 's3:getbucket']],
      ['s3:GetB*', ['s3:getbucket', 's3:getbucketacl']],
    ]);

    const result = createReviewComments(blocks, expanded, [], 10);

    expect(result).toHaveLength(1);
    expect(result[0].body).toContain('s3:getbucket');
    expect(result[0].body).toContain('s3:getbucketacl');
    expect(result[0].body).toContain('s3:getobject');
  });

  it('passes redundant actions to formatComment', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:Get*'],
    }];
    const expanded = new Map([
      ['s3:Get*', ['s3:getobject']],
    ]);

    const result = createReviewComments(blocks, expanded, ['s3:GetObject'], 5);

    expect(result[0].body).toContain('Redundant');
  });

  it('respects collapse threshold', () => {
    const blocks: WildcardBlock[] = [{
      file: 'policy.json',
      startLine: 10,
      endLine: 10,
      actions: ['s3:*'],
    }];
    const manyActions = Array.from({ length: 20 }, (_, i) => `s3:action${i}`);
    const expanded = new Map([['s3:*', manyActions]]);

    const result = createReviewComments(blocks, expanded, [], 5);

    expect(result[0].body).toContain('<details>');
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
      { filename: 'policy.tf', patch: makePatch(['"s3:Get*"', '"s3:GetObject"']) },
    ];

    const result = processFiles(files, [], 5);

    expect(result.redundantActions.length).toBeGreaterThan(0);
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
});
