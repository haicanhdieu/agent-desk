import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Generated: build and test output, the TanStack route tree and the MSW service worker (`msw init`).
  {
    ignores: [
      'dist',
      'storybook-static',
      'parity-out',
      'test-results',
      'playwright-report',
      'src/app/routeTree.gen.ts',
      'public/mockServiceWorker.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The app's `api` (features/api.ts) wires 401 handling; the contracts package's default instance does not.
    files: ['**/*.{ts,tsx,mjs}'],
    ignores: ['src/features/api.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@agentdesk/contracts/client',
              importNames: ['api'],
              message: "Import `api` from '@/features/api' (it handles 401); the contracts default has no hooks.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
