import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

describe('projects route', () => {
  it('lists the org projects linking to their runs, with connection status', async () => {
    await renderRoute('/o/alice/projects');
    const seeded = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
    expect(seeded.length).toBeGreaterThanOrEqual(2);
    for (const p of seeded) {
      const link = await screen.findByRole('link', { name: p.name });
      expect(link).toHaveAttribute('href', `/o/alice/p/${p.id}/runs`);
    }
    const row = screen.getByRole('link', { name: 'invoicer-web' }).closest('tr');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText('Polling every 5 min')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New project/ })).toHaveAttribute('href', '/o/alice/projects/new/repo');
  });

  it('shows the empty state with a create link when the org has no projects', async () => {
    mockDb.state.projects = [];
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('heading', { name: 'Create your first project' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create project/ })).toHaveAttribute('href', '/o/alice/projects/new/repo');
  });

  it('shows an error with retry when the list fails', async () => {
    scenarios.serverError('projects.list');
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows an error when a connection request fails', async () => {
    scenarios.serverError('projects.connection');
    await renderRoute('/o/alice/projects');
    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
