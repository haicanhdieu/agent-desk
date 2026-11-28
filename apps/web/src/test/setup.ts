import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { resetSignOutGuard } from '@/features/auth/signOut';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { installFakeMatchMedia, resetViewportWidth } from './fakeMatchMedia';
import { FakeEventSource } from './fakeEventSource';
import { FakeWebSocket } from './fakeWebSocket';
import { FakeMermaid } from './fakeMermaid';
import { FakeFitAddon, FakeWebglAddon, FakeXterm } from './fakeXterm';

// jsdom cannot open xterm (no canvas, matchMedia or layout): every test, the stories smoke test included, gets the
// fakes in fakeXterm.ts, which record what is written and let tests type.
vi.mock('@xterm/xterm', () => import('./fakeXterm'));
vi.mock('@xterm/addon-fit', () => import('./fakeXterm'));
vi.mock('@xterm/addon-webgl', () => import('./fakeXterm'));

// jsdom cannot draw Mermaid diagrams (no SVG layout): the real @streamdown/mermaid plugin runs on the double in
// fakeMermaid.ts, which draws a stub <svg> for known chart types and rejects the rest.
vi.mock('mermaid', () => import('./fakeMermaid'));

// jsdom has no IntersectionObserver; Streamdown draws a diagram once it is on screen. The stub reports every
// observed element as visible at once.
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      // Cast: the stub gives only the two fields Streamdown reads; the rest of the entry is not needed.
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      // Cast: the stub is not a full IntersectionObserver (no root or thresholds); callers only use observe/disconnect.
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: VisibleObserver,
  configurable: true,
  writable: true,
});

// jsdom has no scrolling; the router's scroll handling calls it on every navigation.
window.scrollTo = () => undefined;

// jsdom has no matchMedia: `useMediaQuery` reads the width set with `setViewportWidth` (default 1440).
installFakeMatchMedia();

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
  resetViewportWidth();
  FakeEventSource.reset();
  FakeWebSocket.reset();
  FakeXterm.reset();
  FakeMermaid.reset();
  FakeFitAddon.nextSize = { cols: 80, rows: 24 };
  FakeFitAddon.hasSize = true;
  FakeWebglAddon.failOnActivate = false;
});
afterAll(() => server.close());
