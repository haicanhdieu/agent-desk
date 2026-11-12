import { ApiError } from '@agentdesk/contracts/client';
import { createRoute } from '@tanstack/react-router';
import { act, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { toastFromError } from './boundaries';
import { useNow } from './useNow';

describe('app shell', () => {
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
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Loaded fine')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders the index route', async () => {
    await renderRoute('/');
    expect(await screen.findByRole('heading', { name: 'Agent Desk' })).toBeInTheDocument();
  });
});

describe('toastFromError', () => {
  it('uses the problem title and detail of an ApiError', () => {
    const e = new ApiError({ status: 409, type: 'conflict', title: 'Run already ended', detail: 'Run 62 ended' });
    expect(toastFromError(e)).toEqual({ tone: 'err', title: 'Run already ended', detail: 'Run 62 ended' });
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
