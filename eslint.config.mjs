// @ts-check
import { FlatCompat } from '@eslint/eslintrc';
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import { dirname } from 'path';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: eslint.configs.recommended,
});

export default defineConfig(
  {
    ignores: ['eslint.config.mjs', 'dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  ...compat.extends(
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:jest/recommended',
  ),
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'module',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'interface',
          format: ['PascalCase'],
          prefix: ['I'],
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
        {
          selector: 'property',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-return-await': 'error',
      'no-promise-executor-return': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'jest/expect-expect': [
        'warn',
        { assertFunctionNames: ['expect', 'request.**.expect'] },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    files: ['**/*.dto.ts', '**/*.entity.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: ['**/redis.service.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  /**
   * e2e specs run sequentially, and that is a correctness requirement rather
   * than a style preference.
   *
   * `createE2eApp` binds its HTTP server through supertest, which listens
   * lazily per request whenever the server has no address of its own.
   * Concurrent requests race to bind the same server, and the losers get
   * `connect ECONNRESET` — a dead socket, with no failed expectation pointing
   * at the cause. It is timing-dependent, so it passes locally and fails on a
   * loaded CI runner, which is precisely how it cost a session to diagnose.
   *
   * The shared `pg.Client` used by e2e probes has the same property from the
   * other direction: it serves one query at a time, and any helper that
   * brackets a read between `app.rls_bootstrap` 1 and 0 will silently return
   * zero rows when interleaved rather than erroring. See OQ-18.
   *
   * A narrower rule — ban `Promise.all` only when it wraps an HTTP request —
   * is not expressible as an ESLint selector, which matches a node rather than
   * searching its descendants for one. Writing a custom rule would mean
   * shipping and maintaining a plugin for a construct that has no legitimate
   * use in these specs today. So the ban is blanket: if a real need for
   * concurrency appears, disable it on the line with a comment explaining why
   * neither hazard above applies.
   */
  {
    files: ['test/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='Promise'][callee.property.name=/^(all|allSettled|race|any)$/]",
          message:
            'e2e specs must run sequentially. Concurrent supertest requests race to bind the lazily-listened server (connect ECONNRESET), and concurrent queries on the shared pg.Client corrupt the app.rls_bootstrap bracket, silently returning zero rows. Await them one at a time.',
        },
      ],
    },
  },
  {
    settings: {
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
        },
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.json',
        },
      },
    },
  },
);
