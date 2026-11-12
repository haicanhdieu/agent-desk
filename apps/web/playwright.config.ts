import { defineConfig, devices } from '@playwright/test';

// Mocked end-to-end: the app built with `vite build --mode mock` (pnpm test:e2e:mock builds it first) and served by
// `vite preview --mode mock`, so MSW answers the API in the browser. No API, no network beyond localhost.
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mock', testMatch: 'mock/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `vite preview --mode mock --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
  },
});
