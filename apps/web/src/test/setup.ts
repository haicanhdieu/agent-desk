import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetSignOutGuard } from '@/features/auth/signOut';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { FakeEventSource } from './fakeEventSource';
import { FakeWebSocket } from './fakeWebSocket';
import { FakeFitAddon, FakeXterm } from './fakeXterm';

// jsdom cannot open xterm (no canvas, matchMedia or layout): every test, the stories smoke test included, gets the
// fakes in fakeXterm.ts, which record what is written and let tests type.
vi.mock('@xterm/xterm', () => import('./fakeXterm'));
vi.mock('@xterm/addon-fit', () => import('./fakeXterm'));

// jsdom has no scrolling; the router's scroll handling calls it on every navigation.
window.scrollTo = () => undefined;

// jsdom has no EventSource: the realtime hooks get the test double (tests drive it through `FakeEventSource`).
Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true, writable: true });

// MSW answers every request in tests (no network): unknown requests fail the test. Handler overrides from
// `scenarios` and store changes are undone after each test.
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // The terminal socket gets the WebSocket test double (tests play the server through `FakeWebSocket`). Installed
  // after `listen`, which wraps the global WebSocket for MSW's (unused) WebSocket handlers.
  Object.defineProperty(globalThis, 'WebSocket', { value: FakeWebSocket, configurable: true, writable: true });
});
afterEach(() => {
  server.resetHandlers();
  mockDb.reset();
  resetSignOutGuard();
  FakeEventSource.reset();
  FakeWebSocket.reset();
  FakeXterm.reset();
  FakeFitAddon.nextSize = { cols: 80, rows: 24 };
});
afterAll(() => server.close());
