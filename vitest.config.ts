import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    pool: 'forks',
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/release/**/*.ts'],
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
