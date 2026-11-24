import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Kept apart from appBar.test.tsx: that file replaces the API and auth clients, this one runs the real routes on MSW.
describe('app bar on the suspended page (BR-51)', () => {
  it('a platform admin of a suspended org still gets the Platform admin entry; /platform/orgs opens', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.platform('suspendedPlatformAdmin'),
    });
    await screen.findByRole('heading', { name: 'This organization is suspended' });
    await user.click(await screen.findByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Platform admin' })).toHaveAttribute('href', '/platform');
    await act(() => router.navigate({ to: '/platform/orgs' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/platform/orgs');
  });
});

describe('Manage this org in Platform', () => {
  const openMenu = async (path: string, scenario: () => void) => {
    const { user } = await renderRoute(path, { scenario });
    await user.click(await screen.findByRole('button', { name: /^Switch scope/ }));
    return within(await screen.findByRole('dialog', { name: 'Scope' }));
  };

  it('a platform admin gets manageHref for the current org', async () => {
    const menu = await openMenu('/o/alice/projects', () => scenarios.platform('platformAdminOrgs'));
    const link = await menu.findByRole('link', { name: 'Manage this org in Platform' });
    expect(link.getAttribute('href')).toMatch(/^\/platform\/orgs\/[0-9a-f-]{36}$/);
  });

  it('an org admin without the platform role gets no manageHref', async () => {
    const menu = await openMenu('/o/alice/projects', () => scenarios.platform('ownerNoPlatform'));
    expect(menu.queryByRole('link', { name: 'Manage this org in Platform' })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Platform admin' })).not.toBeInTheDocument();
  });

  it('a failed GET /api/me/platform gives no Platform group and no manageHref', async () => {
    server.use(http.get('*/api/me/platform', () => HttpResponse.json({ title: 'boom' }, { status: 500 })));
    const menu = await openMenu('/o/alice/projects', () => scenarios.platform('platformAdminOrgs'));
    expect(menu.queryByRole('group', { name: 'Platform' })).not.toBeInTheDocument();
    expect(menu.queryByRole('link', { name: 'Manage this org in Platform' })).not.toBeInTheDocument();
  });
});
