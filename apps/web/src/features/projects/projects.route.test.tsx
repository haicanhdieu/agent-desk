import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { jsonResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
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

  it('"Switch to polling" on a silent webhook project links to its agent settings', async () => {
    await renderRoute('/o/alice/projects');
    const link = await screen.findByRole('link', { name: 'Switch to polling for docs-site' });
    expect(link).toHaveAttribute('href', `/o/alice/p/${ids.project.docsSite}/desk/agent`);
  });

  it('the More menu of a project offers Runs and Settings links and a disabled Delete', async () => {
    await renderRoute('/o/alice/projects');
    const more = await screen.findByRole('button', { name: 'More for invoicer-api' });
    await userEvent.click(more);
    const menu = screen.getByRole('dialog', { name: 'Actions for invoicer-api' });
    expect(within(menu).getByRole('link', { name: 'Runs' })).toHaveAttribute(
      'href',
      `/o/alice/p/${ids.project.invoicerApi}/runs`,
    );
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      `/o/alice/p/${ids.project.invoicerApi}/desk/agent`,
    );
    const del = within(menu).getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    await userEvent.click(del);
    expect(screen.getByRole('dialog', { name: 'Actions for invoicer-api' })).toBeInTheDocument();
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

describe('projects route clock', () => {
  it('advances the last-run text on the useNow tick without refetching', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] });
    try {
      vi.setSystemTime(new Date('2026-11-12T14:14:00.000Z'));
      mockDb.state.projects = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice).slice(0, 1);
      await renderRoute('/o/alice/projects');
      // Seed: last run 14:12Z for invoicer-api.
      expect(await screen.findByText('2 min ago')).toBeInTheDocument();
      const requests = mockDb.requests('GET', '/api/projects');
      await act(async () => {
        vi.setSystemTime(new Date('2026-11-12T14:24:00.000Z'));
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(await screen.findByText('12 min ago')).toBeInTheDocument();
      expect(mockDb.requests('GET', '/api/projects')).toBe(requests);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Replaces the alice projects with `total` rows created one second apart. */
function seedProjects(total: number) {
  const [template] = mockDb.state.projects.filter((p) => p.orgId === ids.org.alice);
  if (!template) throw new Error('seed has no alice project');
  mockDb.state.projects = Array.from({ length: total }, (_, i) => ({
    ...template,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    name: `project-${String(i + 1).padStart(2, '0')}`,
    repoPath: `dev/project-${String(i + 1).padStart(2, '0')}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
}
/** The wide page list comes first; jsdom shows both lists, the CSS container query picks one. */
function pageButton(n: number): HTMLElement {
  const [button] = screen.getAllByRole('button', { name: `Page ${n}` });
  if (!button) throw new Error(`no Page ${n} button`);
  return button;
}
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('projects route paging', () => {
  afterEach(() => localStorage.clear());

  it('shows 20 of 26 rows with the range, and page 2 the other 6 with ?page=2', async () => {
    seedProjects(26);
    const { user, router } = await renderRoute('/o/alice/projects');
    expect(await screen.findByText('Showing')).toBeInTheDocument();
    expect(screen.getByText('1–20')).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);

    await user.click(pageButton(2));

    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(router.state.location.search).toEqual({ page: '2' });
    expect(screen.getByText('21–26')).toBeInTheDocument();
  });

  it('replaces a page past the last with the last page', async () => {
    seedProjects(26);
    const { router } = await renderRoute('/o/alice/projects?page=9');
    await waitFor(() => expect(router.state.location.search).toEqual({ page: '2' }));
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(router.history.length).toBe(1);
  });

  it('shows page 1 for a page number the API would refuse', async () => {
    seedProjects(26);
    const { router } = await renderRoute('/o/alice/projects?page=99999999999');
    expect(await screen.findByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(20);
    expect(router.state.location.search).toEqual({});
  });

  it('shows no pagination with 20 projects', async () => {
    seedProjects(20);
    await renderRoute('/o/alice/projects');
    await screen.findByRole('link', { name: 'project-20' });
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('a new page size shows that many rows and returns to page 1', async () => {
    seedProjects(26);
    const { user, router } = await renderRoute('/o/alice/projects?page=2');
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
    await waitFor(() => expect(bodyRows()).toHaveLength(26));
    expect(router.state.location.search).toEqual({});
    expect(localStorage.getItem('agentdesk.pageSize')).toBe('50');
  });

  it('while page 2 is held, the control still reads "Showing 1–20" with Page 1 current; then the new range', async () => {
    seedProjects(26);
    const page2 = await (await fetch('http://localhost:3000/api/projects?page=2')).json();
    const { user } = await renderRoute('/o/alice/projects');
    await screen.findByText('1–20');
    const nav = () => screen.getByRole('navigation', { name: 'Pagination' });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/projects', async () => {
        await held;
        return jsonResponse(page2);
      }),
    );
    await user.click(pageButton(2));
    await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'true'));
    expect(nav()).toHaveTextContent('Showing 1–20 of 26');
    expect(pageButton(1)).toHaveAttribute('aria-current', 'page');
    release();
    await waitFor(() => expect(nav()).toHaveAttribute('aria-busy', 'false'));
    expect(nav()).toHaveTextContent('Showing 21–26 of 26');
    expect(pageButton(2)).toHaveAttribute('aria-current', 'page');
  });

  it('keeps page 1 on screen, busy, while page 2 loads', async () => {
    seedProjects(26);
    const page2 = await (await fetch('http://localhost:3000/api/projects?page=2')).json();
    const { user } = await renderRoute('/o/alice/projects');
    await screen.findByText('1–20');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/projects', async () => {
        await held;
        return jsonResponse(page2);
      }),
    );

    await user.click(pageButton(2));

    await waitFor(() => expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true'));
    expect(bodyRows()).toHaveLength(20);
    release();
    await waitFor(() => expect(bodyRows()).toHaveLength(6));
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy');
  });
});

/** The first user (the signed-in one) is invited by n pending invitations, as a user in an org gets them. */
function inviteMe(n: number): void {
  const user = mockDb.state.users[0];
  const template = mockDb.state.invitations.find((i) => i.status === 'pending');
  if (!user || !template) throw new Error('scenario has no user or pending invitation');
  mockDb.state.invitations = Array.from({ length: n }, (_, i) => ({
    ...template,
    id: `b7000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    email: user.email.toLowerCase(),
    expiresAt: '2099-01-01T00:00:00.000Z',
  }));
}

describe('projects route invitations banner', () => {
  it('BR-3: shows the pending count and View goes to /invitations', async () => {
    const { router, user } = await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(2);
      },
    });
    expect(await screen.findByText('You have 2 pending invitations.')).toBeInTheDocument();
    const view = screen.getByRole('link', { name: 'View' });
    expect(view).toHaveAttribute('href', '/invitations');
    await user.click(view);
    expect(router.state.location.pathname).toBe('/invitations');
  });

  it('BR-3: says "1 pending invitation" (singular) for exactly one', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(1);
      },
    });
    expect(await screen.findByText('You have 1 pending invitation.')).toBeInTheDocument();
  });

  it('BR-3: is hidden at 0 pending invitations', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(0);
      },
    });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.queryByText(/pending invitation/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'View' })).toBeNull();
  });

  it('BR-3: is hidden when the invitations list fails, and the page still renders', async () => {
    await renderRoute('/o/acme/projects', {
      scenario: () => {
        scenarios.onboarding('owner');
        inviteMe(2);
        scenarios.serverError('me.listInvitations');
      },
    });
    expect(await screen.findByRole('link', { name: 'invoicer-api' })).toBeInTheDocument();
    await waitFor(() => expect(mockDb.requests('GET', '/api/me/invitations')).toBeGreaterThan(0));
    expect(screen.queryByText(/pending invitation/)).toBeNull();
  });
});

describe('projects route controls by role', () => {
  it.each(['member', 'viewer'] as const)('BR-20: a %s sees no Invitations and no New project', async (name) => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding(name) });
    await screen.findByRole('link', { name: 'invoicer-api' });
    expect(screen.queryByRole('link', { name: 'Invitations' })).toBeNull();
    expect(screen.queryByRole('link', { name: /New project/ })).toBeNull();
  });

  it('BR-20: an owner sees Invitations (to the org Invitations page) and New project', async () => {
    await renderRoute('/o/acme/projects', { scenario: () => scenarios.onboarding('owner') });
    expect(await screen.findByRole('link', { name: 'Invitations' })).toHaveAttribute('href', '/o/acme/invitations');
    expect(screen.getByRole('link', { name: /New project/ })).toHaveAttribute('href', '/o/acme/projects/new/repo');
  });
});
