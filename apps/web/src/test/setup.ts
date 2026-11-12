import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetSignOutGuard } from '@/features/auth/signOut';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';

// jsdom has no scrolling; the router's scroll handling calls it on every navigation.
window.scrollTo = () => undefined;

// MSW answers every request in tests (no network): unknown requests fail the test. Handler overrides from
// `scenarios` and store changes are undone after each test.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  mockDb.reset();
  resetSignOutGuard();
});
afterAll(() => server.close());
