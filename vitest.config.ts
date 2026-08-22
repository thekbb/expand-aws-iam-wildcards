import { defineConfig } from 'vitest/config';

export const COVERAGE_THRESHOLDS = {
  statements: 95,
  branches: 95,
  functions: 100,
  lines: 95,
};

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    pool: 'forks',
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      provider: 'v8',
      thresholds: COVERAGE_THRESHOLDS,
      include: [
        'src/**/*.ts',
        'scripts/docs-contract.ts',
        'scripts/iam-data/**/*.ts',
        'scripts/release/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'scripts/release/**/*.test.ts',
        'src/iam-actions.ts',
        'src/index.ts',
        'src/types.ts',
      ],
    },
  },
});
