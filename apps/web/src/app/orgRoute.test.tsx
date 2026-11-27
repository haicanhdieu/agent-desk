import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { ids } from '@/mocks/dto/ids';
import { addPlatformOrg, setPlatformOrgStatus } from '@/mocks/msw/platformOrgs';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyShellScenario } from '@/mocks/msw/shellScenarios';
import { applyTenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

describe('org layout route loads the session access', () => {
  it('a member with no role still sees the no-access state (BR-44)', async () => {
    await renderRoute('/o/alice/projects', {
      scenario: () => {
        server.use(
          http.get('*/api/me/access', () => HttpResponse.json({ userId: 'u', platformAdmin: false, assignments: [] })),
        );
        scenarios.problem('projects.list', { status: 403, title: 'Forbidden', type: 'forbidden' });
      },
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });

  it('a failing access fetch shows the retryable error state, not a crash', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.serverError('me.access') });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('org layout route after a slug change (BR-16)', () => {
  it('TC-16.4: the old slug shows not found and the new slug resolves', async () => {
    const { router, user } = await renderRoute('/o/alice/settings/general', {
      scenario: () => applyTenantAdminScenario(mockDb, 'soleOwner'),
    });
    await screen.findByRole('heading', { level: 1, name: 'General' });
    const url = screen.getByLabelText('URL');
    await user.click(url);
    (url as HTMLInputElement).select();
    await user.paste('acme-new');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Change URL' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme-new/settings/general'));

    await act(() => router.navigate({ to: '/o/$org/projects', params: { org: 'alice' } }));
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Projects' })).not.toBeInTheDocument();

    await act(() => router.navigate({ to: '/o/$org/projects', params: { org: 'acme-new' } }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });
});

describe('org layout route for a suspended organization (BR-37, BR-38, BR-49)', () => {
  const MESSAGE = "You can't open Alice right now. Contact your Agent Desk administrator.";

  it('BR-37: a member opening / sees the fixed message, no project request and no reason', async () => {
    await renderRoute('/', { scenario: () => scenarios.platform('suspendedMember') });
    expect(await screen.findByRole('heading', { name: 'This organization is suspended' })).toBeInTheDocument();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Billing hold/)).not.toBeInTheDocument();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });

  it('BR-37: a member opening the suspended org projects page sees the same message', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.platform('suspendedMember') });
    expect(await screen.findByRole('heading', { name: 'This organization is suspended' })).toBeInTheDocument();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/Billing hold/)).not.toBeInTheDocument();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });

  it('BR-38: a page already open switches to the message when the org starts answering org-suspended', async () => {
    const { queryClient } = await renderRoute('/o/alice/projects', {
      scenario: () => scenarios.onboarding('twoOrgs'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Projects' });
    const org = mockDb.state.orgs.find((o) => o.id === ids.org.alice);
    if (!org) throw new Error('scenario has no Alice org');
    addPlatformOrg({ id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt });
    setPlatformOrgStatus(org.id, 'suspended', 'Billing hold');
    await act(() => queryClient.invalidateQueries({ queryKey: ['org'] }));
    expect(await screen.findByRole('heading', { name: 'This organization is suspended' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Projects' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Billing hold/)).not.toBeInTheDocument();
    // The membership list still says active (stale), yet the shell draws no org menu and asks nothing more of the org.
    expect(screen.queryByRole('navigation', { name: /menu$/ })).toBeNull();
    const asked = mockDb.requests('GET', '/api/me/access');
    await new Promise((r) => setTimeout(r, 100));
    expect(mockDb.requests('GET', '/api/me/access')).toBe(asked);
  });
});

describe('the suspended page in the shell (BR-58, BR-79)', () => {
  it('BR-58: a member with another org gets the message in the main, the switcher and no side menu', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => scenarios.platform('suspendedMember') });
    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { name: 'This organization is suspended' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Switch scope/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /menu/i })).toBeNull();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });

  it('BR-58: a project address under the suspended org shows the same page and no project request', async () => {
    await renderRoute(`/o/alice/p/${ids.project.invoicerApi}/runs`, {
      scenario: () => scenarios.platform('suspendedMember'),
    });
    expect(await screen.findByRole('heading', { name: 'This organization is suspended' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /menu/i })).toBeNull();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });

  it('BR-79: the only org suspended and no platform role: plain org name, no switcher, no side menu', async () => {
    await renderRoute('/o/alice/projects', { scenario: () => applyShellScenario('suspendedOnly') });
    await screen.findByRole('heading', { name: 'This organization is suspended' });
    const bar = screen.getByRole('banner');
    expect(within(bar).queryByRole('button', { name: /^Switch scope/ })).toBeNull();
    expect(within(bar).getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /menu/i })).toBeNull();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });

  it('BR-79: the account menu leaves by "My invitations" and offers "Logout"', async () => {
    const { user, router } = await renderRoute('/o/alice/projects', {
      scenario: () => applyShellScenario('suspendedOnly'),
    });
    await screen.findByRole('heading', { name: 'This organization is suspended' });
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /account/i }));
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'My invitations' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/invitations'));
    expect(screen.queryByRole('navigation', { name: /menu/i })).toBeNull();
    expect(mockDb.requests('GET', '/api/projects')).toBe(0);
  });
});

describe('org layout route titles', () => {
  it('an unknown route sets the title "Not found · Agent Desk"', async () => {
    await renderRoute('/o/alice/no-such-page');
    await screen.findByText('Page not found');
    expect(document.title).toBe('Not found · Agent Desk');
  });
});
