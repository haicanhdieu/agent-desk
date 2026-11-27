import { createRoute } from '@tanstack/react-router';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDocumentTitle } from '@/components';
import { createTestRootRoute, renderRoute } from '@/test/renderRoute';
import { scenarios } from '@/mocks/msw/scenarios';
import { Forbidden, PlatformForbidden } from './boundaries';

function BarTitle() {
  useDocumentTitle('Bar title');
  return null;
}

describe('Forbidden next to a top bar that owns the title', () => {
  it('leaves no stale title after the page unmounts when it does not set one', async () => {
    const root = createTestRootRoute();
    const bar = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => (
        <>
          <BarTitle />
          <Forbidden titled={false} />
        </>
      ),
    });
    const other = createRoute({ getParentRoute: () => root, path: '/projects', component: () => <p>Other page</p> });
    document.title = 'Before';
    const { router } = await renderRoute('/', { routeTree: root.addChildren([bar, other]) });
    await screen.findByRole('heading', { name: "You don't have access" });
    expect(document.title).toBe('Bar title');
    await act(() => router.navigate({ to: '/projects' }));
    await screen.findByText('Other page');
    expect(document.title).toBe('Before');
  });
});

describe('PlatformForbidden', () => {
  it('draws its own org bar when no shell owns the chrome', async () => {
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
