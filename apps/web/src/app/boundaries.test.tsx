import { createRoute } from '@tanstack/react-router';
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { scenarios } from '@/mocks/msw/scenarios';
import { Forbidden, PlatformForbidden } from './boundaries';

describe('Forbidden in the shell', () => {
  it('the shell owns the title and leaves no stale title after the page unmounts', async () => {
    const root = createTestRootRoute();
    const bar = createRoute({ getParentRoute: () => root, path: '/', component: Forbidden });
    const other = createRoute({ getParentRoute: () => root, path: '/projects', component: () => <p>Other page</p> });
    document.title = 'Before';
    const { router } = await renderRoute('/', { routeTree: root.addChildren([bar, other]) });
    await screen.findByRole('heading', { name: "You don't have access" });
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe("You don't have access · Agent Desk"));
    await act(() => router.navigate({ to: '/projects' }));
    await screen.findByText('Other page');
    expect(document.title).toBe('Before');
  });
});

describe('PlatformForbidden', () => {
  it('shows the page inside the shell, whose bar is the only one', async () => {
    const root = createTestRootRoute();
    const page = createRoute({ getParentRoute: () => root, path: '/', component: PlatformForbidden });
    await renderRoute('/', {
      routeTree: root.addChildren([page]),
      scenario: () => scenarios.platform('ownerNoPlatform'),
    });
    await screen.findByRole('heading', { name: "You don't have access" });
    expect(screen.getByText('This area is for platform admins.')).toBeInTheDocument();
    expect(screen.getAllByRole('banner')).toHaveLength(1);
  });
});
