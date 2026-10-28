// ESLint 9 flat config for the frontend. Audit-only for now: it is not wired
// into CI, and the findings it produces are a backlog, not a gate. Uses only
// packages already present in devDependencies.
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  jsxA11y.flatConfigs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2024 },
    },
    plugins: { 'react-hooks': reactHooks },
    settings: {
      react: { version: 'detect' },
      'import/resolver': { node: { extensions: ['.js', '.jsx', '.mjs', '.cjs'] } },
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      // Vite resolves `@/` to `src/` (vite.config.js + jsconfig.json); the
      // node resolver has no alias support without an extra package. It also
      // cannot read package.json `exports` maps, which is how react-router 7+
      // and react-resizable-panels publish — Vite resolves both fine.
      'import/no-unresolved': ['error', { ignore: ['^@/', '^react-router$', '^react-resizable-panels$'] }],
      'react/prop-types': 'off',
    },
  },
];
