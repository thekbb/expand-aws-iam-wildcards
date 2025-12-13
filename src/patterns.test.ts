import { describe, it, expect } from 'vitest';
import { matchesPatterns } from './patterns.js';

describe('matchesPatterns', () => {
  it('matches terraform files', () => {
    expect(matchesPatterns('main.tf', ['**/*.tf'])).toBe(true);
    expect(matchesPatterns('modules/iam/policy.tf', ['**/*.tf'])).toBe(true);
  });

  it('matches json files', () => {
    expect(matchesPatterns('policy.json', ['**/*.json'])).toBe(true);
    expect(matchesPatterns('iam/policy.json', ['**/*.json'])).toBe(true);
  });

  it('does not match non-matching files', () => {
    expect(matchesPatterns('main.tf', ['**/*.json'])).toBe(false);
    expect(matchesPatterns('README.md', ['**/*.tf', '**/*.json'])).toBe(false);
  });

  it('matches with multiple patterns', () => {
    const patterns = ['**/*.tf', '**/*.json'];
    expect(matchesPatterns('main.tf', patterns)).toBe(true);
    expect(matchesPatterns('policy.json', patterns)).toBe(true);
    expect(matchesPatterns('README.md', patterns)).toBe(false);
  });

  it('matches yaml files', () => {
    expect(matchesPatterns('template.yaml', ['**/*.yaml', '**/*.yml'])).toBe(true);
    expect(matchesPatterns('template.yml', ['**/*.yaml', '**/*.yml'])).toBe(true);
  });

  it('handles nested paths', () => {
    expect(matchesPatterns('src/iam/policies/admin.tf', ['**/*.tf'])).toBe(true);
    expect(matchesPatterns('infrastructure/cloudformation/stack.yml', ['**/*.yml'])).toBe(true);
  });
});
