import { describe, expect, it } from 'vitest';

import {
  findPotentialWildcardActions,
  formatComment,
  formatCommentResult,
  groupIntoConsecutiveBlocks,
} from './utils.js';
import type { WildcardMatch } from './types.js';

describe('findPotentialWildcardActions', () => {
  it('finds wildcard actions in quotes and without quotes', () => {
    expect(findPotentialWildcardActions('"s3:Get*"')).toEqual(['s3:Get*']);
    expect(findPotentialWildcardActions("'s3:Get*'")).toEqual(['s3:Get*']);
    expect(findPotentialWildcardActions('s3:Get*')).toEqual(['s3:Get*']);
  });

  it('finds multiple wildcard actions on the same line', () => {
    expect(findPotentialWildcardActions('"s3:Get*", "s3:Put*"')).toEqual([
      's3:Get*',
      's3:Put*',
    ]);
  });

  it('supports service names with hyphens and wildcard suffixes', () => {
    expect(findPotentialWildcardActions('"resource-groups:Get*"')).toEqual([
      'resource-groups:Get*',
    ]);
    expect(findPotentialWildcardActions('"s3:Get*Tagging"')).toEqual(['s3:Get*Tagging']);
    expect(findPotentialWildcardActions('"s3:Get?bject*"')).toEqual(['s3:Get?bject*']);
    expect(findPotentialWildcardActions('"s3:*"')).toEqual(['s3:*']);
  });

  it('returns an empty array for non-wildcard input', () => {
    expect(findPotentialWildcardActions('"s3:GetObject"')).toEqual([]);
    expect(findPotentialWildcardActions('')).toEqual([]);
  });
});

describe('groupIntoConsecutiveBlocks', () => {
  it('returns an empty array for empty input', () => {
    expect(groupIntoConsecutiveBlocks([])).toEqual([]);
  });

  it('creates a single block for consecutive wildcard lines', () => {
    const matches: WildcardMatch[] = [
      { action: 's3:Get*', line: 10, file: 'policy.json' },
      { action: 's3:Put*', line: 11, file: 'policy.json' },
      { action: 's3:Delete*', line: 12, file: 'policy.json' },
    ];

    expect(groupIntoConsecutiveBlocks(matches)).toEqual([
      {
        file: 'policy.json',
        startLine: 10,
        endLine: 12,
        actions: ['s3:Get*', 's3:Put*', 's3:Delete*'],
      },
    ]);
  });

  it('separates non-consecutive lines and different files', () => {
    const matches: WildcardMatch[] = [
      { action: 's3:Get*', line: 10, file: 'policy-a.json' },
      { action: 's3:Put*', line: 20, file: 'policy-a.json' },
      { action: 'ec2:Describe*', line: 21, file: 'policy-b.json' },
    ];

    const result = groupIntoConsecutiveBlocks(matches);

    expect(result).toHaveLength(3);
    expect(result[0]?.file).toBe('policy-a.json');
    expect(result[1]?.startLine).toBe(20);
    expect(result[2]?.file).toBe('policy-b.json');
  });

  it('deduplicates actions within a block and sorts unsorted input by location', () => {
    const matches: WildcardMatch[] = [
      { action: 's3:Delete*', line: 12, file: 'policy.json' },
      { action: 's3:Get*', line: 10, file: 'policy.json' },
      { action: 's3:Get*', line: 11, file: 'policy.json' },
      { action: 's3:Put*', line: 10, file: 'policy.json' },
    ];

    const result = groupIntoConsecutiveBlocks(matches);

    expect(result).toEqual([
      {
        file: 'policy.json',
        startLine: 10,
        endLine: 12,
        actions: ['s3:Get*', 's3:Put*', 's3:Delete*'],
      },
    ]);
  });
});

describe('formatComment', () => {
  it('formats a single wildcard expansion', () => {
    const result = formatComment(['s3:Get*'], ['s3:GetObject', 's3:GetBucket']);

    expect(result).toContain('**IAM Wildcard Expansion**');
    expect(result).toContain('`s3:Get*` expands to 2 action(s):');
    expect(result).toContain('s3:GetObject');
    expect(result).toContain('s3:GetBucket');
    expect(result).not.toContain('<details>');
  });

  it('formats multiple wildcard patterns', () => {
    const result = formatComment(
      ['s3:Get*', 's3:Put*'],
      ['s3:GetObject', 's3:PutObject'],
    );

    expect(result).toContain('2 wildcard patterns expand to 2 action(s):');
    expect(result).toContain('**Patterns:**');
    expect(result).toContain('- `s3:Get*`');
    expect(result).toContain('- `s3:Put*`');
  });

  it('includes AWS documentation links for expanded actions', () => {
    const expanded = ['s3:GetObject', 's3:GetBucket', 's3:GetObjectAcl'];
    const result = formatComment(['s3:Get*'], expanded);

    for (const action of expanded) {
      expect(result).toContain(action);
      expect(result).toContain('docs.aws.amazon.com');
    }
  });

  it('collapses comments when above the threshold', () => {
    const expanded = ['s3:Get1', 's3:Get2', 's3:Get3', 's3:Get4', 's3:Get5', 's3:Get6'];

    expect(formatComment(['s3:Get*'], expanded)).toContain('<details>');
    expect(formatComment(['s3:Get*'], ['s3:Get1', 's3:Get2', 's3:Get3'])).not.toContain('<details>');
    expect(formatComment(['s3:Get*'], ['s3:Get1', 's3:Get2', 's3:Get3'], {
      collapseThreshold: 2,
    })).toContain('<details>');
  });

  it('truncates oversized comments and links to workflow logs when available', () => {
    const expanded = Array.from({ length: 20 }, (_, i) => `unknown:Action${i}`);
    const result = formatCommentResult(
      ['s3:*'],
      expanded,
      {
        maxCommentBodyLength: 325,
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/123',
      },
    );

    expect(result.truncated).toBe(true);
    expect(result.renderedActionsCount).toBeGreaterThan(0);
    expect(result.renderedActionsCount).toBeLessThan(expanded.length);
    expect(result.body).toContain('workflow run logs');
    expect(result.body).toContain('Showing first');
  });

  it('truncates oversized comments without a log link when no URL is available', () => {
    const expanded = Array.from({ length: 20 }, (_, i) => `unknown:Action${i}`);
    const result = formatCommentResult(
      ['s3:*'],
      expanded,
      { maxCommentBodyLength: 325 },
    );

    expect(result.truncated).toBe(true);
    expect(result.renderedActionsCount).toBeGreaterThan(0);
    expect(result.renderedActionsCount).toBeLessThan(expanded.length);
    expect(result.body).toContain('Showing first');
    expect(result.body).not.toContain('workflow run logs');
  });

  it('falls back to a minimal comment when nothing else fits', () => {
    const expanded = Array.from({ length: 20 }, (_, i) => `unknown:Action${i}`);

    const withLogLink = formatCommentResult(
      ['s3:*'],
      expanded,
      {
        maxCommentBodyLength: 10,
        truncationUrl: 'https://github.com/thekbb/expand-aws-iam-wildcards/actions/runs/123',
      },
    );
    const withoutLogLink = formatCommentResult(
      ['s3:*'],
      expanded,
      { maxCommentBodyLength: 10 },
    );

    expect(withLogLink.truncated).toBe(true);
    expect(withLogLink.renderedActionsCount).toBe(0);
    expect(withLogLink.body).toContain('Expanded actions were omitted from this comment');
    expect(withLogLink.body).toContain('workflow run logs');

    expect(withoutLogLink.truncated).toBe(true);
    expect(withoutLogLink.renderedActionsCount).toBe(0);
    expect(withoutLogLink.body).toContain('Expanded actions were omitted from this comment');
    expect(withoutLogLink.body).not.toContain('workflow run logs');
  });
});
