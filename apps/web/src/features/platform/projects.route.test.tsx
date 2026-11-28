import { screen, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ACME = 'b8000000-0000-4000-8000-000000000001';
const projectsPath = `/platform/orgs/${ACME}/projects`;
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const ready = () => screen.findByRole('heading', { level: 2, name: 'Projects' });
const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('Platform org Projects tab', () => {
  it('BR-24: the side menu Projects link opens the section with its heading', async () => {
    const { user, router } = await renderRoute(`/platform/orgs/${ACME}`, { scenario: asAdmin });
    const menu = await screen.findByRole('navigation', { name: 'Platform menu' });
    await user.click(await within(menu).findByRole('link', { name: 'Projects' }));
    await ready();
    expect(router.state.location.pathname).toBe(projectsPath);
    expect(within(menu).getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
  });

  it('BR-25: shows the Name and Id columns only, each project as plain text with no link', async () => {
    await renderRoute(projectsPath, { scenario: asAdmin });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Id']);
    const first = within(bodyRows()[0] as HTMLElement);
    expect(first.getAllByRole('cell').map((c) => c.textContent)).toEqual([
      'Alpha',
      'b8100000-0000-4000-8000-000000000001',
    ]);
    expect(first.queryByRole('link')).not.toBeInTheDocument();
    expect(first.queryByRole('button')).not.toBeInTheDocument();
  });

  it('BR-25: ?page=2 shows the rest and Members keeps its own page', async () => {
    const { user, router } = await renderRoute(projectsPath, { scenario: asAdmin });
    await ready();
    expect(bodyRows()).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText('Project 25');
    expect(router.state.location.search).toMatchObject({ page: '2' });
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Members' }).getAttribute('href')).not.toContain('page');
  });

  it('shows the loading state', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/projects', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderRoute(projectsPath, { scenario: asAdmin });
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/projects', () =>
        HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    );
    await renderRoute(projectsPath, { scenario: asAdmin });
    expect(await screen.findByText('No projects')).toBeInTheDocument();
  });

  it('shows a server error with Retry', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/projects', () => problemResponse({ status: 500, title: 'Server exploded' })),
    );
    const { user } = await renderRoute(projectsPath, { scenario: asAdmin });
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });
});
