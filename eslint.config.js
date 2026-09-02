import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    ignores: ['dist/', 'node_modules/', '*.js'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'child_process',
            message: 'Action runtime code must treat pull-request content as data.',
          },
          {
            name: 'node:child_process',
            message: 'Action runtime code must treat pull-request content as data.',
          },
          {
            name: 'node:vm',
            message: 'Action runtime code must not evaluate pull-request content.',
          },
          {
            name: 'vm',
            message: 'Action runtime code must not evaluate pull-request content.',
          },
        ],
      }],
    },
  },
);
