import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectMemberDto } from '@agentdesk/contracts';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { applyProjectSpace, type ProjectSpaceRole, type ProjectSpaceScenario } from '@/mocks/msw/projectSpaceScenarios';
import { renderRoute } from '@/test/renderRoute';

const P = ids.project.invoicerApi;
const page = (search = '') => `/o/alice/p/${P}/desk/members${search}`;

const as = (role: ProjectSpaceRole, scenario?: ProjectSpaceScenario) => () =>
  applyProjectSpace(mockDb, scenario === undefined ? { role } : { role, scenario });
const ready = () => screen.findByRole('heading', { level: 1, name: 'Members' });
const rows = () => screen.getAllByRole('row').slice(1);
type User = Awaited<ReturnType<typeof renderRoute>>['user'];

const problem = (status: number, title: string, requestId?: string) =>
  HttpResponse.json(
    { type: 'about:blank', title, status, ...(requestId !== undefined && { requestId }) },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );

/** Every request that changes or lists the project's people. */
function watch() {
  const puts: { url: string; body: unknown }[] = [];
  const deletes: string[] = [];
  const lists: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (request.method === 'PUT' && /\/members\/[^/]+\/role$/.test(pathname)) {
      void request
        .clone()
        .json()
        .then((body: unknown) => puts.push({ url: request.url, body }));
    }
    if (request.method === 'DELETE' && /^\/api\/projects\/[^/]+\/members\/[^/]+$/.test(pathname)) {
      deletes.push(request.url);
    }
    if (request.method === 'GET' && /^\/api\/projects\/[^/]+\/members$/.test(pathname)) lists.push(request.url);
  };
  server.events.on('request:start', listener);
  return { puts, deletes, lists, stop: () => server.events.removeListener('request:start', listener) };
}

const rowOf = (name: string) => {
  const row = rows().find((r) => within(r).queryByText(name) !== null);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};
const openMenu = async (user: User, name: string) => {
  await user.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }));
};
const openChange = async (user: User, name: string) => {
  await openMenu(user, name);
  await user.click(await screen.findByRole('button', { name: 'Change role' }));
  return screen.findByRole('dialog', { name: `Change role for ${name}` });
};
const openRemove = async (user: User, name: string) => {
  await openMenu(user, name);
  await user.click(await screen.findByRole('button', { name: 'Remove from project' }));
  return screen.findByRole('dialog', { name: /^Remove .+ from .+\?$/ });
};

describe('change a project role (BR-6)', () => {
  it('offers Admin, Member and Viewer with the current one picked and Save role disabled until it differs', async () => {
    const { user } = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const dialog = await openChange(user, 'Cleo Martin');
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent ?? '')).toEqual([
      expect.stringContaining('Admin'),
      expect.stringContaining('Member'),
      expect.stringContaining('Viewer'),
    ]);
    expect(within(dialog).queryByText('No role')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Member/ })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Save role' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
    expect(within(dialog).getByRole('button', { name: 'Save role' })).toBeEnabled();
  });

  it('saves, toasts "Role changed" and refetches the members list', async () => {
    const { user } = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const w = watch();
    try {
      const dialog = await openChange(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
      expect(await screen.findByText('Role changed')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(rowOf('Cleo Martin')).toHaveTextContent('Viewer'));
      expect(w.puts).toHaveLength(1);
      expect(w.lists.length).toBeGreaterThanOrEqual(1);
    } finally {
      w.stop();
    }
  });

  it('invalidates the project members, org members and project audit lists after a save', async () => {
    const view = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const spy = vi.spyOn(view.queryClient, 'invalidateQueries');
    const dialog = await openChange(view.user, 'Cleo Martin');
    await view.user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
    await view.user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    await screen.findByText('Role changed');
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'members', 'list']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'members']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'audit', 'list']));
  });

  it('two quick presses of Save role send one request and the dialog cannot be closed while saving', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = watch();
    try {
      const { user } = await renderRoute(page(), {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'projectAdmin' });
          server.use(
            http.put('*/api/projects/:projectId/members/:userId/role', async () => {
              await held;
              return problem(500, 'Internal server error');
            }),
          );
        },
      });
      await ready();
      const dialog = await openChange(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
      const save = within(dialog).getByRole('button', { name: 'Save role' });
      await Promise.all([user.click(save), user.click(save)]);
      expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Change role for Cleo Martin' })).toBeInTheDocument();
      expect(w.puts).toHaveLength(1);
      await act(async () => {
        release();
        await held;
      });
    } finally {
      w.stop();
    }
  });

  it('a failed save lets the next press of Save role send a second request', async () => {
    const w = watch();
    try {
      const { user } = await renderRoute(page(), {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'projectAdmin' });
          server.use(
            http.put('*/api/projects/:projectId/members/:userId/role', () => problem(500, 'Internal server error')),
          );
        },
      });
      await ready();
      const dialog = await openChange(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
      expect(await screen.findByText('Internal server error')).toBeInTheDocument();
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save role' })).toBeEnabled());
      await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
      await waitFor(() => expect(w.puts).toHaveLength(2));
    } finally {
      w.stop();
    }
  });

  it('reads the role cards when the page opens, so Change role needs no wait', async () => {
    const roleReads: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'GET' && /^\/api\/orgs\/[^/]+\/roles$/.test(new URL(request.url).pathname)) {
        roleReads.push(request.url);
      }
    };
    server.events.on('request:start', listener);
    try {
      await renderRoute(page(), { scenario: as('projectAdmin') });
      await ready();
      await waitFor(() => expect(roleReads).toHaveLength(1));
    } finally {
      server.events.removeListener('request:start', listener);
    }
  });

  it('roles that fail to load toast the problem and leave no dialog open', async () => {
    const { user } = await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(http.get('*/api/orgs/:orgId/roles', () => problem(500, 'Roles unavailable')));
      },
    });
    await ready();
    await openMenu(user, 'Cleo Martin');
    await user.click(await screen.findByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('Roles unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a 404 closes the dialog, toasts "Member is no longer on this project" and refetches the list', async () => {
    const w = watch();
    try {
      const { user } = await renderRoute(page(), { scenario: as('projectAdmin', 'roleRemovedMeanwhile') });
      await ready();
      const dialog = await openChange(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
      expect(await screen.findByText('Member is no longer on this project')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.queryByText('Cleo Martin')).not.toBeInTheDocument());
      expect(w.lists.length).toBeGreaterThanOrEqual(2);
    } finally {
      w.stop();
    }
  });

  it('a 403 keeps the dialog open with the "You don\'t have access" banner and the request id', async () => {
    const { user } = await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(
          http.put('*/api/projects/:projectId/members/:userId/role', () => problem(403, 'Forbidden', 'req-edit-403')),
        );
      },
    });
    await ready();
    const dialog = await openChange(user, 'Cleo Martin');
    await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await within(dialog).findByText("You don't have access")).toBeInTheDocument();
    expect(within(dialog).getByText('Request ID: req-edit-403')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Change role for Cleo Martin' })).toBeInTheDocument();
  });

  it('an org switched in another tab (409) keeps the dialog and shows the org-switched message', async () => {
    const { user } = await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(
          http.put('*/api/projects/:projectId/members/:userId/role', () =>
            HttpResponse.json(
              { type: 'urn:agentdesk:problem:org-mismatch', title: 'Conflict', status: 409 },
              { status: 409, headers: { 'content-type': 'application/problem+json' } },
            ),
          ),
        );
      },
    });
    await ready();
    const dialog = await openChange(user, 'Cleo Martin');
    await user.click(within(dialog).getByRole('radio', { name: /Viewer/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await screen.findByText(/organization was switched|switched/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Change role for Cleo Martin' })).toBeInTheDocument();
  });

  it('the own row has no menu to open', async () => {
    await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    expect(within(rowOf('Lee Park')).queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });
});

describe('remove from the project (BR-8)', () => {
  it('asks to confirm, removes, toasts "<name> removed from <project>" and moves focus to the Members heading', async () => {
    const { user } = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const w = watch();
    try {
      const dialog = await openRemove(user, 'Cleo Martin');
      expect(within(dialog).getByText(/They lose their role on this project\./)).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      expect(await screen.findByText('Cleo Martin removed from invoicer-api')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.queryByRole('cell', { name: /Cleo Martin/ })).not.toBeInTheDocument());
      expect(w.deletes).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toHaveFocus();
    } finally {
      w.stop();
    }
  });

  it('invalidates the project members, org members and project audit lists after a remove', async () => {
    const view = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const spy = vi.spyOn(view.queryClient, 'invalidateQueries');
    const dialog = await openRemove(view.user, 'Cleo Martin');
    await view.user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await screen.findByText('Cleo Martin removed from invoicer-api');
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'members', 'list']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'members']));
    expect(keys).toContain(JSON.stringify(['org', 'alice', 'projects', P, 'audit', 'list']));
  });

  it('Cancel sends nothing', async () => {
    const { user } = await renderRoute(page(), { scenario: as('projectAdmin') });
    await ready();
    const w = watch();
    try {
      const dialog = await openRemove(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(w.deletes).toEqual([]);
    } finally {
      w.stop();
    }
  });

  it('two quick presses of Remove send one request and the confirm cannot be closed while it runs', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const w = watch();
    try {
      const { user } = await renderRoute(page(), {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'projectAdmin' });
          server.use(
            http.delete('*/api/projects/:projectId/members/:userId', async () => {
              await held;
              return new HttpResponse(null, { status: 204 });
            }),
          );
        },
      });
      await ready();
      const dialog = await openRemove(user, 'Cleo Martin');
      const confirm = within(dialog).getByRole('button', { name: 'Remove' });
      await Promise.all([user.click(confirm), user.click(confirm)]);
      expect(await within(dialog).findByRole('button', { name: 'Removing…' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(w.deletes).toHaveLength(1);
      await act(async () => {
        release();
        await held;
      });
    } finally {
      w.stop();
    }
  });

  it('a failed remove lets the next confirm send a second request', async () => {
    const w = watch();
    try {
      const { user } = await renderRoute(page(), {
        scenario: () => {
          applyProjectSpace(mockDb, { role: 'projectAdmin' });
          server.use(
            http.delete('*/api/projects/:projectId/members/:userId', () =>
              HttpResponse.json(
                { type: 'urn:agentdesk:problem:org-mismatch', title: 'Conflict', status: 409 },
                { status: 409, headers: { 'content-type': 'application/problem+json' } },
              ),
            ),
          );
        },
      });
      await ready();
      const dialog = await openRemove(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await screen.findByText(/switched/i);
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeEnabled());
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(w.deletes).toHaveLength(2));
    } finally {
      w.stop();
    }
  });

  it('a 404 toasts "Member is no longer on this project", closes the confirm and refetches the list', async () => {
    const w = watch();
    try {
      const { user } = await renderRoute(page(), { scenario: as('projectAdmin', 'roleRemovedMeanwhile') });
      await ready();
      const dialog = await openRemove(user, 'Cleo Martin');
      await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
      expect(await screen.findByText('Member is no longer on this project')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect(screen.queryByText('Cleo Martin')).not.toBeInTheDocument());
      expect(w.lists.length).toBeGreaterThanOrEqual(2);
    } finally {
      w.stop();
    }
  });

  it('a 403 for a demoted caller is a toast with the request id, never a crash', async () => {
    const { user } = await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(
          http.delete('*/api/projects/:projectId/members/:userId', () => problem(403, 'Forbidden', 'req-rm-403')),
        );
      },
    });
    await ready();
    const dialog = await openRemove(user, 'Cleo Martin');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText("You don't have access")).toBeInTheDocument();
    expect(screen.getByText(/req-rm-403/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
  });

  it('an org switched in another tab (409) keeps the confirm open and shows the org-switched message', async () => {
    const { user } = await renderRoute(page(), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        server.use(
          http.delete('*/api/projects/:projectId/members/:userId', () =>
            HttpResponse.json(
              { type: 'urn:agentdesk:problem:org-mismatch', title: 'Conflict', status: 409 },
              { status: 409, headers: { 'content-type': 'application/problem+json' } },
            ),
          ),
        );
      },
    });
    await ready();
    const dialog = await openRemove(user, 'Cleo Martin');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/switched/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('removing the only row of the last page lands on the new last page (Review Focus 3)', async () => {
    const { user } = await renderRoute(page('?page=2'), {
      scenario: () => {
        applyProjectSpace(mockDb, { role: 'projectAdmin' });
        const base = mockDb.state.projectSpace.members[P] ?? [];
        const cleo = base.find((m) => m.userId === 'user-tenant-4');
        if (!cleo) throw new Error('fixture');
        const extra = Array.from({ length: 21 - base.length }, (_, i): ProjectMemberDto => ({
          ...structuredClone(cleo),
          userId: `user-bulk-${i + 1}`,
          name: `Bulk ${String(i + 1).padStart(2, '0')}`,
          handle: `bulk${i + 1}`,
        }));
        mockDb.state.projectSpace.members[P] = [...base, ...extra];
      },
    });
    await ready();
    expect(rows()).toHaveLength(1);
    const dialog = await openRemove(user, 'Bulk 15');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Bulk 15 removed from invoicer-api')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(20));
    expect(screen.queryByText('No project roles yet')).not.toBeInTheDocument();
  });
});
