import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'dist',
      'coverage',
      'reports',
      '.stryker-tmp',
      '*.cjs',
      'e2e/artifacts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
      eqeqeq: 'error',
      complexity: ['error', 15],
    },
  },
  {
    // Serverless functions: console.error is the only channel into the platform logs,
    // and it never reaches the client (errors return typed codes only).
    files: ['api/**/*.ts'],
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },
  {
    // Plain Node scripts: no TS project, console is their output channel.
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        // Browser globals used inside page.evaluate() closures.
        document: 'readonly',
        getComputedStyle: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  { files: ['scripts/**'], rules: { 'no-console': 'off' } },
  {
    // Playwright spec files: browser globals, node output channel, no TS project needed
    // beyond the service they already get (they are excluded from tsconfig's src project).
    files: ['e2e/specs/**/*.spec.ts'],
    languageOptions: {
      globals: {
        document: 'readonly',
        console: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  { files: ['*.config.js'], ...tseslint.configs.disableTypeChecked },
);
