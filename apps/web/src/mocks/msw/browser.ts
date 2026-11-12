import { setupWorker } from 'msw/browser';
import { z } from 'zod';
import { mockDb } from './db';
import { handlers } from './handlers';
import { setScenarioTarget } from './scenarios';

/** MSW service worker for `dev:mock` and Storybook. */
export const worker = setupWorker(...handlers);
setScenarioTarget(worker);

// Sign-in and sign-out reload the page (the social sign-in redirects), so the auth state survives reloads in
// sessionStorage. The rest of the store starts from the seed on every page load.
const AUTH_KEY = 'agentdesk.mock.auth';
const StoredAuth = z.object({ signedIn: z.boolean(), activeOrganizationId: z.string().nullable() });

function loadAuth(): void {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    if (raw === null) return;
    const parsed = StoredAuth.safeParse(JSON.parse(raw));
    if (parsed.success) mockDb.restoreAuth(parsed.data);
  } catch {
    // Storage blocked or corrupt: keep the seed (signed in as alice).
  }
}

function saveAuth(): void {
  try {
    sessionStorage.setItem(AUTH_KEY, JSON.stringify(mockDb.auth));
  } catch {
    // Storage blocked: auth state just won't survive a reload.
  }
}

let started: Promise<unknown> | undefined;

/** Starts the worker once; later calls reuse the first start. */
export function startMockWorker(opts: { quiet?: boolean } = {}): Promise<unknown> {
  started ??= (async () => {
    loadAuth();
    worker.events.on('response:mocked', ({ request }) => {
      if (new URL(request.url).pathname.startsWith('/auth/')) saveAuth();
    });
    return worker.start({ onUnhandledRequest: 'bypass', quiet: opts.quiet ?? false });
  })();
  return started;
}
