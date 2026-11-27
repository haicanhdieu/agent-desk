import { ApiError } from '@agentdesk/contracts/client';
import { createMemoryHistory, createRoute } from '@tanstack/react-router';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { AppProviders } from '@/app/providers';
import { createAppQueryClient } from '@/app/queryClient';
import { createAppRouter } from '@/app/router';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { toastFromError } from './boundaries';
import { useNow } from './useNow';

describe('app shell', () => {
  it('the skip link is the first focusable element', async () => {
    const { user } = await renderRoute('/unknown');
    await screen.findByRole('heading', { name: 'Page not found' });
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
  });

  it('BR-12: an unknown path has one main and the skip link focuses it', async () => {
    const { user } = await renderRoute('/unknown');
    await screen.findByRole('heading', { name: 'Page not found' });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(main);
  });

  it('BR-12: an unknown path keeps the top bar and shows no side menu', async () => {
    await renderRoute('/unknown', { scenario: () => scenarios.onboarding('twoOrgs') });
    await screen.findByRole('heading', { name: 'Page not found' });
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: /menu/i })).toBeNull();
  });

  it('BR-16: for a slug the person is not in, "Go to projects" does not point back at that slug', async () => {
    await renderRoute('/o/not-mine/projects', { scenario: () => scenarios.onboarding('twoOrgs') });
    await screen.findByRole('heading', { name: 'Page not found' });
    const link = screen.getByRole('link', { name: 'Go to projects' });
    expect(link.getAttribute('href')).not.toContain('not-mine');
    expect(link).toHaveAttribute('href', '/');
  });

  it('BR-13: a project page open when its read starts answering 404 becomes Not found and names the project nowhere', async () => {
    const { queryClient } = await renderRoute(`/o/alice/p/${ids.project.invoicerApi}/runs`);
    await screen.findByRole('heading', { level: 1, name: 'Runs' });
    expect(screen.getAllByText('invoicer-api').length).toBeGreaterThan(0);

    server.use(
      http.get('*/api/projects/:projectId', () =>
        HttpResponse.json({ type: 'about:blank', title: 'Not found', status: 404 }, { status: 404 }),
      ),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['org', 'alice', 'projects', ids.project.invoicerApi] }));

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryAllByText('invoicer-api')).toHaveLength(0);
    expect(document.title).not.toContain('invoicer-api');
  });

  it('shows NotFound for an unknown path', async () => {
    await renderRoute('/unknown');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows the loader error banner for a 5xx and Retry re-runs the loader', async () => {
    let calls = 0;
    const root = createTestRootRoute();
    const flaky = createRoute({
      getParentRoute: () => root,
      path: '/flaky',
      loader: () => {
        calls += 1;
        if (calls === 1) throw new ApiError({ status: 500, type: 'about:blank', title: 'Database unavailable' });
        return 'ok';
      },
      component: () => <p>Loaded fine</p>,
    });
    const { user } = await renderRoute('/flaky', { routeTree: root.addChildren([flaky]) });

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    // The page that loads after the error is no longer inside the shell the error page asked for, so it mounts once more.
    await waitFor(() => expect(screen.getByText('Loaded fine')).toBeInTheDocument());
    expect(calls).toBe(2);
  });

  it('treats a network failure (status 0) as a retryable banner too', async () => {
    const root = createTestRootRoute();
    const offline = createRoute({
      getParentRoute: () => root,
      path: '/offline',
      loader: () => {
        throw new ApiError({ status: 0, type: 'network', title: 'Network error' });
      },
      component: () => null,
    });
    await renderRoute('/offline', { routeTree: root.addChildren([offline]) });
    expect(await screen.findByText('Network error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('maps a loader 404 (another org record included) to NotFound with a link to projects', async () => {
    const root = createTestRootRoute();
    const gone = createRoute({
      getParentRoute: () => root,
      path: '/o/$org/gone',
      loader: () => {
        throw new ApiError({ status: 404, type: 'about:blank', title: 'Not found' });
      },
      component: () => null,
    });
    await renderRoute('/o/alice/gone', { routeTree: root.addChildren([gone]) });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/o/alice/projects');
    await waitFor(() => expect(document.title).toBe('Not found · Agent Desk'));
  });

  it('maps a loader 403 to Forbidden', async () => {
    const root = createTestRootRoute();
    const secret = createRoute({
      getParentRoute: () => root,
      path: '/secret',
      loader: () => {
        throw new ApiError({ status: 403, type: 'about:blank', title: 'Forbidden' });
      },
      component: () => null,
    });
    await renderRoute('/secret', { routeTree: root.addChildren([secret]) });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("You don't have access · Agent Desk"));
  });

  it('shows RootErrorBoundary with the request id when rendering crashes', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const root = createTestRootRoute();
    const crash = createRoute({
      getParentRoute: () => root,
      path: '/crash',
      component: () => {
        throw new ApiError({ status: 422, type: 'about:blank', title: 'Unexpected', requestId: 'req-crash-1' });
      },
    });
    await renderRoute('/crash', { routeTree: root.addChildren([crash]) });
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText(/req-crash-1/)).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('sends a user without an organization to the welcome page', async () => {
    await renderRoute('/', { scenario: () => (mockDb.state.memberships = []) });
    expect(await screen.findByRole('heading', { name: "You're not a member of any organization" })).toBeInTheDocument();
  });
});

describe('toastFromError', () => {
  it('uses the problem title and detail of an ApiError', () => {
    const e = new ApiError({ status: 409, type: 'conflict', title: 'Run already ended', detail: 'Run 62 ended' });
    expect(toastFromError(e)).toEqual({ tone: 'err', title: 'Run already ended', detail: 'Run 62 ended' });
  });
  it('shows the switched-in-another-tab text for an org-mismatch error', () => {
    const e = new ApiError({ status: 409, type: 'org-mismatch', title: 'Conflict' });
    expect(toastFromError(e)).toEqual({ tone: 'err', title: ORG_SWITCHED_MESSAGE });
  });
  it('falls back for unknown errors', () => {
    expect(toastFromError('boom')).toEqual({ tone: 'err', title: 'Something went wrong' });
    expect(toastFromError(new Error('kaput'))).toEqual({ tone: 'err', title: 'Something went wrong', detail: 'kaput' });
  });
});

describe('useNow', () => {
  it('ticks every 30 s and shares one clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T14:00:00Z'));
    const a = renderHook(() => useNow());
    const b = renderHook(() => useNow());
    expect(a.result.current.toISOString()).toBe('2026-11-12T14:00:00.000Z');
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(a.result.current.toISOString()).toBe('2026-11-12T14:00:00.000Z');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(a.result.current.toISOString()).toBe('2026-11-12T14:00:30.000Z');
    expect(b.result.current).toBe(a.result.current);
    a.unmount();
    b.unmount();
    vi.useRealTimers();
  });
});

describe('a signed-out load (session guard)', () => {
  it('draws no shell and sends no platform, org or access read before the redirect to sign-in', async () => {
    const wire: string[] = [];
    const onRequest = ({ request }: { request: Request }) => {
      wire.push(`${request.method} ${new URL(request.url).pathname}`);
    };
    server.events.on('request:start', onRequest);
    scenarios.signedOut();
    // A slow session read: the route's pending page (shown after 300 ms) is on screen while the session is unknown.
    server.use(
      http.get('*/auth/get-session', async () => {
        await delay(700);
        return undefined;
      }),
    );
    // The shell's landmarks must never appear: watch the DOM for the whole load, not just its end.
    let sawShell = false;
    let sawPending = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector('header, nav[aria-label$="menu"]')) sawShell = true;
      if (document.querySelector('[aria-busy="true"]')) sawPending = true;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    try {
      // Not through renderRoute: its act() holds back the renders of the pending page.
      const queryClient = createAppQueryClient({ retryDelay: 0 });
      const router = createAppRouter({
        queryClient,
        history: createMemoryHistory({ initialEntries: ['/o/alice/projects'] }),
      });
      render(<AppProviders router={router} queryClient={queryClient} />);
      await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'), { timeout: 4000 });
    } finally {
      watch.disconnect();
      server.events.removeListener('request:start', onRequest);
    }
    expect(sawPending, 'the pending page was on screen while the session was unknown').toBe(true);
    expect(sawShell).toBe(false);
    expect(wire.filter((r) => /\/api\/(me|projects)|organization\/list/.test(r))).toEqual([]);
  });
});
