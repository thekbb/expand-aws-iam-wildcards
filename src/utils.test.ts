import { describe, it, expect } from 'vitest';
import {
  findPotentialWildcardActions,
  findExplicitActions,
  groupIntoConsecutiveBlocks,
  formatComment,
} from './utils.js';
import type { WildcardMatch } from './types.js';

describe('findPotentialWildcardActions', () => {
  describe('quote handling', () => {
    it('finds action in double quotes', () => {
      expect(findPotentialWildcardActions('"s3:Get*"')).toEqual(['s3:Get*']);
    });

    it('finds action in single quotes', () => {
      expect(findPotentialWildcardActions("'s3:Get*'")).toEqual(['s3:Get*']);
    });

    it('finds action without quotes', () => {
      expect(findPotentialWildcardActions('s3:Get*')).toEqual(['s3:Get*']);
    });
  });

  describe('multiple matches', () => {
    it('finds multiple wildcards on same line', () => {
      expect(findPotentialWildcardActions('"s3:Get*", "s3:Put*"')).toEqual([
        's3:Get*',
        's3:Put*',
      ]);
    });

    it('finds wildcards in JSON array', () => {
      const line = '    "Action": ["s3:Get*", "ec2:Describe*"],';
      expect(findPotentialWildcardActions(line)).toEqual(['s3:Get*', 'ec2:Describe*']);
    });
  });

  describe('wildcard patterns', () => {
    it('finds wildcards with trailing characters', () => {
      expect(findPotentialWildcardActions('"s3:Get*Tagging"')).toEqual(['s3:Get*Tagging']);
    });

    it('finds wildcards with question marks', () => {
      expect(findPotentialWildcardActions('"s3:Get?bject*"')).toEqual(['s3:Get?bject*']);
    });

    it('finds service:* pattern', () => {
      expect(findPotentialWildcardActions('"s3:*"')).toEqual(['s3:*']);
    });
  });

  describe('edge cases', () => {
    it('returns empty for non-wildcard actions', () => {
      expect(findPotentialWildcardActions('"s3:GetObject"')).toEqual([]);
    });

    it('returns empty for empty string', () => {
      expect(findPotentialWildcardActions('')).toEqual([]);
    });

    it('handles service names with hyphens', () => {
      expect(findPotentialWildcardActions('"resource-groups:Get*"')).toEqual([
        'resource-groups:Get*',
      ]);
    });
  });
});

describe('findExplicitActions', () => {
  it('finds explicit actions in double quotes', () => {
    expect(findExplicitActions('"s3:GetObject"')).toEqual(['s3:GetObject']);
  });

  it('finds explicit actions in single quotes', () => {
    expect(findExplicitActions("'s3:GetObject'")).toEqual(['s3:GetObject']);
  });

  it('finds multiple explicit actions', () => {
    expect(findExplicitActions('"s3:GetObject", "s3:PutObject"')).toEqual([
      's3:GetObject',
      's3:PutObject',
    ]);
  });

  it('ignores wildcard actions', () => {
    expect(findExplicitActions('"s3:Get*"')).toEqual([]);
  });

  it('finds explicit actions mixed with wildcards', () => {
    const line = '"s3:Get*", "s3:GetObject", "s3:PutObject"';
    expect(findExplicitActions(line)).toEqual(['s3:GetObject', 's3:PutObject']);
  });

  it('returns empty for empty string', () => {
    expect(findExplicitActions('')).toEqual([]);
  });

  it('handles service names with hyphens', () => {
    expect(findExplicitActions('"resource-groups:GetGroup"')).toEqual([
      'resource-groups:GetGroup',
    ]);
  });

  it('requires quotes around actions', () => {
    expect(findExplicitActions('s3:GetObject')).toEqual([]);
  });
});

describe('groupIntoConsecutiveBlocks', () => {
  describe('basic grouping', () => {
    it('returns empty array for empty input', () => {
      expect(groupIntoConsecutiveBlocks([])).toEqual([]);
    });

    it('creates single block for one match', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy.json' },
      ];

      expect(groupIntoConsecutiveBlocks(matches)).toEqual([
        {
          file: 'policy.json',
          startLine: 10,
          endLine: 10,
          actions: ['s3:Get*'],
        },
      ]);
    });

    it('groups consecutive lines into one block', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy.json' },
        { action: 's3:Put*', line: 11, file: 'policy.json' },
        { action: 's3:Delete*', line: 12, file: 'policy.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        file: 'policy.json',
        startLine: 10,
        endLine: 12,
        actions: ['s3:Get*', 's3:Put*', 's3:Delete*'],
      });
    });
  });

  describe('block separation', () => {
    it('separates non-consecutive lines', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy.json' },
        { action: 's3:Put*', line: 20, file: 'policy.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(2);
      expect(result[0]?.endLine).toBe(10);
      expect(result[1]?.startLine).toBe(20);
    });

    it('separates different files', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy1.json' },
        { action: 's3:Put*', line: 11, file: 'policy2.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(2);
      expect(result[0]?.file).toBe('policy1.json');
      expect(result[1]?.file).toBe('policy2.json');
    });
  });

  describe('deduplication and sorting', () => {
    it('deduplicates actions within block', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy.json' },
        { action: 's3:Get*', line: 11, file: 'policy.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(1);
      expect(result[0]?.actions).toEqual(['s3:Get*']);
    });

    it('handles unsorted input', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Delete*', line: 12, file: 'policy.json' },
        { action: 's3:Get*', line: 10, file: 'policy.json' },
        { action: 's3:Put*', line: 11, file: 'policy.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(1);
      expect(result[0]?.startLine).toBe(10);
      expect(result[0]?.endLine).toBe(12);
    });

    it('handles multiple actions on same line', () => {
      const matches: WildcardMatch[] = [
        { action: 's3:Get*', line: 10, file: 'policy.json' },
        { action: 's3:Put*', line: 10, file: 'policy.json' },
      ];

      const result = groupIntoConsecutiveBlocks(matches);

      expect(result).toHaveLength(1);
      expect(result[0]?.actions).toEqual(['s3:Get*', 's3:Put*']);
    });
  });
});

describe('formatComment', () => {
  it('formats single wildcard expansion', () => {
    const result = formatComment(['s3:Get*'], ['s3:GetObject', 's3:GetBucket']);

    expect(result).toContain('**IAM Wildcard Expansion**');
    expect(result).toContain('`s3:Get*` expands to 2 action(s):');
    expect(result).toContain('s3:GetObject');
    expect(result).toContain('s3:GetBucket');
    expect(result).not.toContain('<details>'); // Below threshold
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

  it('includes all expanded actions with links', () => {
    const expanded = ['s3:GetObject', 's3:GetBucket', 's3:GetObjectAcl'];
    const result = formatComment(['s3:Get*'], expanded);

    for (const action of expanded) {
      expect(result).toContain(action);
      expect(result).toContain('docs.aws.amazon.com'); // Should have links
    }
  });

  it('collapses when above threshold', () => {
    const expanded = ['s3:Get1', 's3:Get2', 's3:Get3', 's3:Get4', 's3:Get5', 's3:Get6'];
    const result = formatComment(['s3:Get*'], expanded);

    expect(result).toContain('<details>');
    expect(result).toContain('Click to expand');
  });

  it('does not collapse when at threshold', () => {
    const expanded = ['s3:Get1', 's3:Get2', 's3:Get3', 's3:Get4', 's3:Get5'];
    const result = formatComment(['s3:Get*'], expanded);

    expect(result).not.toContain('<details>');
  });

  it('respects custom collapse threshold', () => {
    const expanded = ['s3:Get1', 's3:Get2', 's3:Get3'];
    const result = formatComment(['s3:Get*'], expanded, { collapseThreshold: 2 });

    expect(result).toContain('<details>');
  });

  it('shows redundant actions warning when provided', () => {
    const result = formatComment(
      ['s3:Get*'],
      ['s3:GetObject', 's3:GetBucket'],
      { redundantActions: ['s3:GetObject'] },
    );

    expect(result).toContain('⚠️ Redundant actions detected');
    expect(result).toContain('`s3:GetObject`');
  });

  it('shows multiple redundant actions', () => {
    const result = formatComment(
      ['s3:Get*'],
      ['s3:GetObject', 's3:GetBucket'],
      { redundantActions: ['s3:GetObject', 's3:GetBucket'] },
    );

    expect(result).toContain('⚠️ Redundant actions detected');
    expect(result).toContain('- `s3:GetObject`');
    expect(result).toContain('- `s3:GetBucket`');
  });

  it('does not show warning when no redundant actions', () => {
    const result = formatComment(['s3:Get*'], ['s3:GetObject', 's3:GetBucket']);

    expect(result).not.toContain('⚠️');
    expect(result).not.toContain('Redundant');
  });

  it('does not show warning when redundant actions is empty array', () => {
    const result = formatComment(['s3:Get*'], ['s3:GetObject'], { redundantActions: [] });

    expect(result).not.toContain('⚠️');
    expect(result).not.toContain('Redundant');
  });
});
