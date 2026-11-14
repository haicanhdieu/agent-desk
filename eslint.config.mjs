// Backend lint config (api, worker, core, db, contracts, scripts). apps/web has its own config and is not linted here.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '.agentdesk/**',
      'apps/web/**',
      'design/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Same convention as tsc's noUnusedParameters: a leading underscore marks an intentionally unused binding
      // (interface-mandated parameters, rest-omit destructuring).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // no-useless-assignment does not see uses inside TypeScript parameter decorators (`@Param(Pipe)`), so it flags
    // module-level pipe constants that are used only there. Off for controllers only, where that pattern lives.
    files: ['apps/api/src/**/*.controller.ts'],
    rules: { 'no-useless-assignment': 'off' },
  },
);
