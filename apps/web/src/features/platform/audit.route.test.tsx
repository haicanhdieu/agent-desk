import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ready = () => screen.findByRole('heading', { level: 1, name: 'Audit log' });
const rows = () => screen.getAllByRole('row').slice(1);
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const ACME = 'b8000000-0000-4000-8000-000000000001';
const UNKNOWN = 'b8000000-0000-4000-8000-0000000000ff';

describe('Platform audit log', () => {
  it('BR-45: lists the entries newest first with the columns When, Who, What', async () => {
    await renderRoute('/platform/audit', { scenario: asAdmin });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    expect(rows()).toHaveLength(11);
    expect(rows()[0]).toHaveTextContent(
      'Dev Admin revoked the invitation for new@example.com to a deleted organization',
    );
    expect(rows()[10]).toHaveTextContent('Dev Admin added pat@example.com as a platform admin');
  });

  it('BR-45: a suspended entry carries its reason as a note', async () => {
    await renderRoute('/platform/audit', { scenario: asAdmin });
    await ready();
    expect(screen.getByText('Reason: Billing hold')).toBeInTheDocument();
  });

  it('BR-50: the Action select puts action in the URL and All actions removes it', async () => {
    const { user, router } = await renderRoute('/platform/audit', { scenario: asAdmin });
    await ready();
    expect(within(screen.getByRole('combobox', { name: 'Action' })).getAllByRole('option')).toHaveLength(12);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'Organization suspended');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ action: 'org.suspended' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('Dev Admin suspended Orbit Systems');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Action' }), 'All actions');
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('action'));
    await waitFor(() => expect(rows()).toHaveLength(11));
  });

  it('BR-50: an empty filtered list offers Clear filters', async () => {
    server.use(
      http.get('/api/platform/audit', () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
    );
    const { user, router } = await renderRoute('/platform/audit?action=org.created', { scenario: asAdmin });
    expect(await screen.findByText('No audit entries match')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(1));
    expect(router.state.location.search).toEqual({});
  });

  it('BR-50: ?org=<id> shows the chip "Organization: <name>" and sends orgId; removing it lists all', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => urls.push(request.url));
    const { user, router } = await renderRoute(`/platform/audit?org=${ACME}`, { scenario: asAdmin });
    await ready();
    expect(await screen.findByText('Organization: Acme')).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/api/platform/audit') && u.includes(`orgId=${ACME}`))).toBe(true);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().length).toBeLessThan(11);
    expect(screen.queryByRole('combobox', { name: 'Organization' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove filter Organization: Acme' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('org'));
    await waitFor(() => expect(rows()).toHaveLength(11));
    expect(screen.queryByText('Organization: Acme')).not.toBeInTheDocument();
    server.events.removeAllListeners();
  });

  it('BR-50: an unknown org id shows "Unknown organization" and an empty list', async () => {
    await renderRoute(`/platform/audit?org=${UNKNOWN}`, { scenario: asAdmin });
    await ready();
    expect(await screen.findByText('Unknown organization')).toBeInTheDocument();
    expect(await screen.findByText('No audit entries match')).toBeInTheDocument();
  });

  it('Review Focus 3: ?org=abc shows "Unknown organization", an empty list and sends no audit request', async () => {
    const urls: string[] = [];
    server.events.on('request:start', ({ request }) => urls.push(request.url));
    await renderRoute('/platform/audit?org=abc', { scenario: asAdmin });
    await ready();
    expect(screen.getByText('Unknown organization')).toBeInTheDocument();
    expect(screen.getByText('No audit entries match')).toBeInTheDocument();
    expect(urls.filter((u) => u.includes('/api/platform/audit') || u.includes('/api/platform/orgs/abc'))).toEqual([]);
    server.events.removeAllListeners();
  });

  it('BR-45: "View audit log" on the org detail opens /platform/audit?org=<id>', async () => {
    const { user, router } = await renderRoute(`/platform/orgs/${ACME}`, { scenario: asAdmin });
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'View audit log' }));
    await ready();
    expect(router.state.location.pathname).toBe('/platform/audit');
    expect(router.state.location.search).toMatchObject({ org: ACME });
    expect(await screen.findByText('Organization: Acme')).toBeInTheDocument();
  });

  it('BR-4: shows the loading state while the list is requested', async () => {
    server.use(
      http.get('/api/platform/audit', async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 });
      }),
    );
    await renderRoute('/platform/audit', { scenario: asAdmin });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('No audit entries')).toBeInTheDocument();
  });

  it('BR-4: a failing list shows the problem title and Retry loads it again', async () => {
    const { user } = await renderRoute('/platform/audit', {
      scenario: () => {
        asAdmin();
        scenarios.serverError('platform.listAudit');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(rows()).toHaveLength(11);
  });

  it('a 403 from the list shows the forbidden state', async () => {
    await renderRoute('/platform/audit', {
      scenario: () => {
        asAdmin();
        scenarios.problem('platform.listAudit', { status: 403, title: 'Forbidden', type: 'forbidden' });
      },
    });
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });
});
