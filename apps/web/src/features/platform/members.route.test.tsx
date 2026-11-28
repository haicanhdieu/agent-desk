import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { platformProjectFixtures } from '@/mocks/dto/platform';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock.
const ACME = 'b8000000-0000-4000-8000-000000000001';
const membersPath = `/platform/orgs/${ACME}/members`;
const asAdmin = () => scenarios.platform('platformAdminOrgs');
const ready = () => screen.findByRole('heading', { level: 2, name: 'Members' });
const rowOf = (name: string): HTMLElement => {
  const row = screen.getAllByRole('row').find((r) => within(r).queryByText(name) !== null);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
};
const openAdd = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await openMenu(user, name);
  await user.click(await screen.findByRole('button', { name: 'Add assignment' }));
  return screen.findByRole('dialog', { name: 'Add assignment' });
};
const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .filter((o) => !(o as HTMLOptionElement).disabled)
    .map((o) => o.textContent);

describe('Platform org Members tab', () => {
  it('BR-24: the side menu Members link opens the section with its heading', async () => {
    const { user, router } = await renderRoute(`/platform/orgs/${ACME}`, { scenario: asAdmin });
    const menu = await screen.findByRole('navigation', { name: 'Platform menu' });
    await user.click(await within(menu).findByRole('link', { name: 'Members' }));
    await ready();
    expect(router.state.location.pathname).toBe(membersPath);
  });

  it('BR-26: shows name, handle, email and roles with scopes, a dash for none and the handle alone for no name', async () => {
    await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Email',
      'Roles',
      'Actions',
    ]);
    expect(screen.getByText(/Platform view: names and emails only/)).toBeInTheDocument();
    const alice = within(rowOf('Alice Acme'));
    expect(alice.getByText('alice')).toBeInTheDocument();
    expect(alice.getByText('alice@example.com')).toBeInTheDocument();
    expect(alice.getByText('Owner (organization), Member (Alpha)')).toBeInTheDocument();
    expect(within(rowOf('Cara Idle')).getByText('—')).toBeInTheDocument();
    const nameless = within(rowOf('noname@example.com'));
    expect(nameless.getByText('noname')).toBeInTheDocument();
    expect(nameless.getByText('Viewer (organization)')).toBeInTheDocument();
  });

  it('BR-27: Add assignment offers Owner, Admin, Member, Viewer for the whole organization', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Bob Builder'));
    expect(dialog.getByRole('radio', { name: /Whole organization/ })).toBeChecked();
    expect(optionsOf(dialog.getByLabelText('Role'))).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
  });

  it('BR-27: One project adds the project select and drops Owner', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Bob Builder'));
    await user.click(dialog.getByRole('radio', { name: /One project/ }));
    expect(optionsOf(dialog.getByLabelText('Role'))).toEqual(['Admin', 'Member', 'Viewer']);
    const projects = optionsOf(dialog.getByLabelText('Project'));
    expect(projects[0]).toBe('Alpha');
    expect(projects).toHaveLength(25);
  });

  it('BR-26, BR-27: with more than 100 projects a role on a later one keeps its name and the select offers it', async () => {
    const filler = Array.from({ length: 125 }, (_, i) => ({
      id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Filler ${i + 1}`,
    }));
    const all = [...filler, ...platformProjectFixtures.map(({ id, name }) => ({ id, name }))];
    server.use(
      http.get('*/api/platform/orgs/:orgId/projects', ({ request }) => {
        const url = new URL(request.url);
        const page = Number(url.searchParams.get('page') ?? '1');
        const pageSize = Math.min(Number(url.searchParams.get('pageSize') ?? '20'), 100);
        return HttpResponse.json({
          items: all.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: all.length,
        });
      }),
    );
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    expect(await screen.findByText('Owner (organization), Member (Alpha)')).toBeInTheDocument();
    const dialog = within(await openAdd(user, 'Bob Builder'));
    await user.click(dialog.getByRole('radio', { name: /One project/ }));
    const projects = optionsOf(dialog.getByLabelText('Project'));
    expect(projects).toHaveLength(150);
    expect(projects).toContain('Alpha');
  });

  it('a failed projects read still shows the members with "a project" labels; the dialog says projects are unavailable', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/projects', () => problemResponse({ status: 500, title: 'Projects down' })),
    );
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    expect(await screen.findByText('Owner (organization), Member (a project)')).toBeInTheDocument();
    expect(screen.queryByText('Projects down')).not.toBeInTheDocument();
    const dialog = within(await openAdd(user, 'Bob Builder'));
    await user.click(dialog.getByRole('radio', { name: /One project/ }));
    await user.selectOptions(dialog.getByLabelText('Role'), 'Member');
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await dialog.findByText('Projects could not be loaded.')).toBeInTheDocument();
  });

  it('BR-27: adding an org-wide Owner sends role owner, toasts and shows "Owner (organization)"', async () => {
    const posts: unknown[] = [];
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && request.url.endsWith('/assignments')) posts.push(await request.clone().json());
    });
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Bob Builder'));
    await user.selectOptions(dialog.getByLabelText('Role'), 'Owner');
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await screen.findByText('Assignment added')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Bob Builder')).getByText(/Owner \(organization\)/)).toBeInTheDocument());
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ userId: 'user-detail-bob', scope: { type: 'org' } });
    expect(posts[0]).toHaveProperty('roleId');
    server.events.removeAllListeners();
  });

  it('adds a project role with the chosen project', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Cara Idle'));
    await user.click(dialog.getByRole('radio', { name: /One project/ }));
    await user.selectOptions(dialog.getByLabelText('Role'), 'Viewer');
    await user.selectOptions(dialog.getByLabelText('Project'), 'Alpha');
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await screen.findByText('Assignment added')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Cara Idle')).getByText('Viewer (Alpha)')).toBeInTheDocument());
  });

  it('asks for a role, and a project, before sending anything', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Cara Idle'));
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await dialog.findByText('Choose a role.')).toBeInTheDocument();
    await user.click(dialog.getByRole('radio', { name: /One project/ }));
    await user.selectOptions(dialog.getByLabelText('Role'), 'Member');
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await dialog.findByText('Choose a project.')).toBeInTheDocument();
    expect(screen.queryByText('Assignment added')).not.toBeInTheDocument();
  });

  it('a refused add keeps the dialog with the Banner and the request id', async () => {
    server.use(
      http.post('*/api/platform/orgs/:orgId/assignments', () =>
        problemResponse({ status: 500, title: 'Server exploded', requestId: 'req-assign-1' }),
      ),
    );
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const dialog = within(await openAdd(user, 'Cara Idle'));
    await user.selectOptions(dialog.getByLabelText('Role'), 'Member');
    await user.click(dialog.getByRole('button', { name: 'Add assignment' }));
    expect(await dialog.findByText('Server exploded')).toBeInTheDocument();
    expect(dialog.getByText(/req-assign-1/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add assignment' })).toBeInTheDocument();
  });

  it('BR-28: Remove asks first; Cancel keeps the assignment', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    await openMenu(user, 'Alice Acme');
    await user.click(await screen.findByRole('button', { name: 'Remove Member (Alpha)' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove Member (Alpha) from Alice Acme?' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(rowOf('Alice Acme')).getByText('Owner (organization), Member (Alpha)')).toBeInTheDocument();
  });

  it('BR-28: confirming removes it, toasts and leaves the other assignment', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    await openMenu(user, 'Alice Acme');
    await user.click(await screen.findByRole('button', { name: 'Remove Member (Alpha)' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove Member (Alpha) from Alice Acme?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Assignment removed')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Alice Acme')).getByText('Owner (organization)')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('BR-28: removing the last owner is allowed and invalidates the org directory', async () => {
    const { user, queryClient } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await openMenu(user, 'Alice Acme');
    await user.click(await screen.findByRole('button', { name: 'Remove Owner (organization)' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove Owner (organization) from Alice Acme?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Assignment removed')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['platform', 'orgs'] }));
  });

  it('a remove that finds the assignment gone toasts the error, closes the confirm and fetches the list again', async () => {
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    await ready();
    server.use(
      http.delete('*/api/platform/orgs/:orgId/assignments/:assignmentId', () =>
        problemResponse({ status: 404, title: 'Assignment not found' }),
      ),
    );
    await openMenu(user, 'Alice Acme');
    await user.click(await screen.findByRole('button', { name: 'Remove Member (Alpha)' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Assignment not found')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the loading state', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/members', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderRoute(membersPath, { scenario: asAdmin });
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/members', () =>
        HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 }),
      ),
    );
    await renderRoute(membersPath, { scenario: asAdmin });
    expect(await screen.findByText('No members')).toBeInTheDocument();
  });

  it('shows a server error with Retry', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/members', () => problemResponse({ status: 500, title: 'Server exploded' })),
    );
    const { user } = await renderRoute(membersPath, { scenario: asAdmin });
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(screen.getByText('Alice Acme')).toBeInTheDocument();
  });
});
