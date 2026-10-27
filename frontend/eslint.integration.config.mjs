import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
export default [{ files: ['**/*.{js,jsx,mjs,cjs}'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } }, plugins: { react, 'react-hooks': hooks, 'jsx-a11y': a11y }, settings: { react: { version: '19.2' } }, rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'react/jsx-key': 'error', ...hooks.configs.recommended.rules, 'jsx-a11y/label-has-associated-control': 'error', 'jsx-a11y/alt-text': 'error' } }];
