import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/types.ts',
      ],
    },
  },
});
