import { defineConfig, devices } from '@playwright/test';

// Two suites, one per run:
// - mock (`pnpm test:e2e:mock`): the app built with `vite build --mode mock` (the script builds it first) and served by
//   `vite preview --mode mock`, so MSW answers the API in the browser. No API, no network beyond localhost.
// - local (`pnpm test:e2e:local`, or `playwright test e2e/local`): the Vite dev server, whose proxy forwards `/api`
//   (with the terminal WebSocket), `/auth` and `/dev` to the real API on :3000. Needs the stack from `pnpm dev` at the
//   repo root (KUBE_MODE=fake, ENABLE_FAKE_PROVIDER=true, AUTH_DEV_LOGIN=true); a running dev server is reused.
// The suite comes from E2E_TARGET (`local` | `mock`, set by the package scripts); only when it is unset (e.g. devbox's
// `playwright test e2e/local`) is it read from the CLI path.
const target = process.env['E2E_TARGET'];
const local =
  target === undefined
    ? process.argv.some((a) => a === '--project=local' || /(^|[\\/])e2e[\\/]local([\\/]|$)/.test(a))
    : target === 'local';
// Test workers load this config again without the CLI arguments; the environment they inherit keeps the choice.
process.env['E2E_TARGET'] = local ? 'local' : 'mock';

const MOCK_PORT = 4173;
const LOCAL_PORT = 5173;
const BASE_URL = `http://localhost:${local ? LOCAL_PORT : MOCK_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: local ? 'retain-on-failure' : 'on-first-retry',
  },
  projects: local
    ? [{ name: 'local', testMatch: 'local/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } }]
    : [{ name: 'mock', testMatch: 'mock/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } }],
  webServer: local
    ? {
        command: `vite --port ${LOCAL_PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
      }
    : {
        command: `vite preview --mode mock --port ${MOCK_PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: false,
      },
});
