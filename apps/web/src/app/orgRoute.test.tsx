import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { ids } from '@/mocks/dto/ids';
import { addPlatformOrg, setPlatformOrgStatus } from '@/mocks/msw/platformOrgs';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
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
  });
});
