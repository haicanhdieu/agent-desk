import type { Page } from '@playwright/test';

/*
 * Mock-mode controls for the e2e specs. There is no test hook in the app: these use what `vite --mode mock` already
 * does (src/main.tsx starts MSW only in mock mode; src/mocks/msw/browser.ts).
 *
 * - Fresh state per test: the mock store (src/mocks/msw/db.ts) lives in page memory and is seeded on every page load,
 *   and Playwright gives each test a new browser context. So every test starts from the seed: signed in as alice,
 *   active org alice, the fixture projects, rules and runs. Navigate with clicks after the first `page.goto`: a second
 *   `goto` reloads the page and reseeds the store.
 * - Signed-out start: browser.ts restores the auth state from sessionStorage (`agentdesk.mock.auth`) so the social
 *   sign-in redirect keeps it. `startSignedOut` writes "signed out" there before the first page load only, so the
 *   MSW sign-in survives the redirect that follows.
 * - Run script: browser.ts scripts run 63 of invoicer-api (DEFAULT_RUN_SCRIPT in stream-handlers.ts) to go
 *   queued → starting → running → idle once its event stream opens, about 16 s in all.
 */

const AUTH_KEY = 'agentdesk.mock.auth';
const SEEDED_KEY = 'agentdesk.e2e.seeded';

/** The seeded org slug and the project that holds the scripted run. */
export const ORG = 'alice';
export const INVOICER_API = 'a0000000-0000-4000-8000-000000000001';
export const SCRIPTED_RUN = 63;

/** The first page load of this test starts signed out (get-session null, API 401). */
export async function startSignedOut(page: Page): Promise<void> {
  await page.addInitScript(
    ([authKey, seededKey]) => {
      if (sessionStorage.getItem(seededKey) !== null) return;
      sessionStorage.setItem(seededKey, '1');
      sessionStorage.setItem(authKey, JSON.stringify({ signedIn: false, activeOrganizationId: null }));
    },
    [AUTH_KEY, SEEDED_KEY] as const,
  );
}
