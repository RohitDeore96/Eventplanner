import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

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
    // Rules of Hooks: every hook call must be unconditional and in the same order on
    // every render. Adopted as part of the code-quality pass; the expense edit form's
    // wrapper/child split (PR #2) already follows it.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // JSX accessibility: the recommended set guards labels, alt text, keyboard handlers,
    // ARIA usage and ARIA correctness across the UI. Genuine violations are fixed, not
    // suppressed; anything not applicable to this app is configured below, never off.
    files: ['src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The app's data tables are scrollable regions made keyboard-accessible with
      // tabIndex={0} — the WCAG "scrollable region keyboard accessible" technique
      // (0ssw9k). <table> is therefore exempt; every other non-interactive element
      // with tabIndex is still an error, and positive tabIndex values stay banned
      // (no source file uses them).
      'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: ['table'] }],
    },
  },
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
    // Production code only: every function in src/ stays at 240 lines or fewer
    // (measured maximum after the 2026-11 structure pass: 239 in src/ui).
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    rules: {
      'max-lines-per-function': ['error', 240],
    },
  },
  {
    // The UI layer is composed of small, focused components: complexity 11 is the
    // measured maximum after the 2026-11 structure pass (three view functions sit
    // at exactly 11). The engine keeps the global limit of 15 — its reducers are
    // financial logic where a forced split would risk behaviour changes.
    files: ['src/ui/**'],
    rules: {
      complexity: ['error', 11],
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
