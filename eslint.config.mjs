import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/proto/gen/**', 'sandbox/**'],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      'eqeqeq': 'error',
      'no-param-reassign': 'error',
      'curly': 'error',
      'no-trailing-spaces': 'error',
      'no-multi-spaces': 'error',
      '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/comma-dangle': ['error', 'always-multiline'],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/space-before-blocks': ['error', 'always'],
      '@stylistic/keyword-spacing': 'error',
      '@stylistic/arrow-spacing': 'error',
      '@stylistic/space-infix-ops': 'error',
      '@stylistic/member-delimiter-style': ['error', {
        multiline: { delimiter: 'semi', requireLast: true },
        singleline: { delimiter: 'semi', requireLast: false },
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
