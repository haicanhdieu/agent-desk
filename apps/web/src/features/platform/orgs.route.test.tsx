import { ORG_SEARCH_MAX, type PlatformOrgDto } from '@agentdesk/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { seedPlatformOrgs } from '@/mocks/msw/platformOrgs';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ready = () => screen.findByRole('heading', { level: 1, name: 'Organizations' });
const rows = () => screen.getAllByRole('row').slice(1);
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const uuid = (n: number) => `c3000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = (n: number, over: Partial<PlatformOrgDto> = {}): PlatformOrgDto => ({
  id: uuid(n),
  name: `Org ${n}`,
  slug: `org-${n}`,
  memberCount: 1,
  createdAt: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`,
  status: 'active',
  suspendedAt: null,
  projectCount: 0,
  lastActivityAt: null,
  owner: null,
  ...over,
});
const withOrgs = (orgs: PlatformOrgDto[]) => () => {
  asAdmin();
  seedPlatformOrgs(orgs);
};

describe('Organizations directory', () => {
  it('BR-18: lists the orgs newest first with the columns', async () => {
    await renderRoute('/platform/orgs', { scenario: withOrgs([org(1), org(3), org(2)]) });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Organization',
      'Owner',
      'Members',
      'Projects',
      'Last activity',
      'Status',
      'Created',
    ]);
    expect(rows().map((r) => within(r).getAllByRole('link')[0]?.textContent)).toEqual(['Org 3', 'Org 2', 'Org 1']);
  });

  it('BR-19: shows "No owner yet" and "No activity yet" for an org without them', async () => {
    await renderRoute('/platform/orgs', { scenario: withOrgs([org(1)]) });
    await ready();
    expect(within(rows()[0]!).getByText('No owner yet')).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('No activity yet')).toBeInTheDocument();
  });

  it('BR-20: typing ACME puts q in the URL and lists only Acme', async () => {
    const { user, router } = await renderRoute('/platform/orgs', { scenario: asAdmin });
    await ready();
    await user.type(screen.getByRole('searchbox', { name: 'Search organizations' }), 'ACME');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'ACME' }), { timeout: 3000 });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Acme')).toBeInTheDocument();
  });

  it('BR-20: the status select puts status in the URL and lists only those orgs', async () => {
    const { user, router } = await renderRoute('/platform/orgs', { scenario: asAdmin });
    await ready();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'suspended');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'suspended' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Orbit Systems')).toBeInTheDocument();
  });

  it('TC-20.5: a filter change resets the page to 1', async () => {
    const many = Array.from({ length: 25 }, (_, i) => org(i + 1));
    const { user, router } = await renderRoute('/platform/orgs?page=2', { scenario: withOrgs(many) });
    await ready();
    expect(router.state.location.search).toMatchObject({ page: '2' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'active' }));
    expect(router.state.location.search).not.toHaveProperty('page');
  });

  it('BR-20: changing the status before the search debounce fires keeps both in the URL', async () => {
    const { user, router } = await renderRoute('/platform/orgs', { scenario: asAdmin });
    await ready();
    await user.type(screen.getByRole('searchbox', { name: 'Search organizations' }), 'orb');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'suspended');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'orb', status: 'suspended' }), {
      timeout: 3000,
    });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('orb');
  });

  it('anything invalid in the URL is dropped: a bad status and a q over the limit', async () => {
    const { router } = await renderRoute(`/platform/orgs?status=bogus&q=${'x'.repeat(ORG_SEARCH_MAX + 1)}`, {
      scenario: asAdmin,
    });
    await ready();
    expect(router.state.location.search).not.toHaveProperty('status');
    expect(router.state.location.search).not.toHaveProperty('q');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('');
    await waitFor(() => expect(rows().length).toBeGreaterThan(1));
  });

  it('BR-20: "No organizations match" offers Clear filters, which clears both filters', async () => {
    const { user, router } = await renderRoute('/platform/orgs?q=zzz-no-match&status=suspended', {
      scenario: asAdmin,
    });
    expect(await screen.findByText('No organizations match')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(1));
    expect(router.state.location.search).toEqual({});
    expect(screen.getByRole('searchbox', { name: 'Search organizations' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
  });

  it('BR-21: "Create organization" goes to /orgs/new', async () => {
    await renderRoute('/platform/orgs', { scenario: asAdmin });
    await ready();
    expect(screen.getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', '/orgs/new');
  });

  it('BR-4: shows the empty state', async () => {
    await renderRoute('/platform/orgs', { scenario: withOrgs([]) });
    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('BR-4: shows the loading state while the list is requested', async () => {
    server.use(
      http.get('/api/platform/orgs', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
      }),
    );
    await renderRoute('/platform/orgs', { scenario: asAdmin });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('No organizations yet')).toBeInTheDocument();
  });

  it('BR-4: a failing list shows the problem title and Retry loads it again', async () => {
    const { user } = await renderRoute('/platform/orgs', {
      scenario: () => {
        asAdmin();
        scenarios.serverError('platform.listOrgs');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('a 403 from the list shows the forbidden state', async () => {
    await renderRoute('/platform/orgs', {
      scenario: () => {
        asAdmin();
        scenarios.problem('platform.listOrgs', { status: 403, title: 'Forbidden', type: 'forbidden' });
      },
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });

  it('BR-2: /platform redirects to /platform/orgs', async () => {
    const { router } = await renderRoute('/platform', { scenario: asAdmin });
    await ready();
    expect(router.state.location.pathname).toBe('/platform/orgs');
  });

  it('a page past the last one lands on page 1 when the filter leaves one match', async () => {
    const { router } = await renderRoute('/platform/orgs?page=5&q=acme', { scenario: asAdmin });
    await ready();
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('page'));
    expect(router.state.location.search).toMatchObject({ q: 'acme' });
    expect(rows()).toHaveLength(1);
  });

  it('shows an org name that holds markup as text', async () => {
    await renderRoute('/platform/orgs', { scenario: withOrgs([org(1, { name: '<img src=x onerror=alert(1)>' })]) });
    await ready();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('main img')).toBeNull();
  });
});
