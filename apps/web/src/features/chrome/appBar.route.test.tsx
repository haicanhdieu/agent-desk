import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Kept apart from appBar.test.tsx: that file replaces the API and auth clients, this one runs the real routes on MSW.
describe('app bar on the suspended page (BR-51)', () => {
  it('a platform admin of a suspended org still gets the Platform entry; /platform/orgs opens', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.platform('suspendedPlatformAdmin'),
    });
    await screen.findByRole('heading', { name: 'This organization is suspended' });
    await user.click(await screen.findByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Platform' })).toHaveAttribute('href', '/platform');
    await act(() => router.navigate({ to: '/platform/orgs' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Organizations' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/platform/orgs');
  });
});

describe('Manage in Platform (BR-20)', () => {
  const orgMenu = async (scenario: () => void) => {
    await renderRoute('/o/alice/projects', { scenario });
    return within(await screen.findByRole('navigation', { name: 'Organization menu' }));
  };

  it('a platform admin gets the item for the current org at the bottom of the menu', async () => {
    const menu = await orgMenu(() => scenarios.platform('platformAdminOrgs'));
    const link = await menu.findByRole('link', { name: 'Manage in Platform' });
    expect(link.getAttribute('href')).toMatch(/^\/platform\/orgs\/[0-9a-f-]{36}$/);
  });

  it('an org admin without the platform role gets no item and no Platform entry', async () => {
    const menu = await orgMenu(() => scenarios.platform('ownerNoPlatform'));
    await menu.findByRole('link', { name: 'Projects' });
    expect(menu.queryByRole('link', { name: 'Manage in Platform' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Platform' })).not.toBeInTheDocument();
  });

  it('a failed GET /api/me/platform gives no item', async () => {
    server.use(http.get('*/api/me/platform', () => HttpResponse.json({ title: 'boom' }, { status: 500 })));
    const menu = await orgMenu(() => scenarios.platform('platformAdminOrgs'));
    await menu.findByRole('link', { name: 'Projects' });
    expect(menu.queryByRole('link', { name: 'Manage in Platform' })).not.toBeInTheDocument();
  });
});
