import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { orgAccessQuery } from '@/features/access/queries';
import { membersListKey } from '@/features/members/queries';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes, real `can()` over the mock API's grants; only the data behind the API is faked.
const asRole = (scenario: TenantAdminScenario) => () => applyTenantAdminScenario(mockDb, scenario);
const ready = () => screen.findByRole('heading', { level: 1, name: 'Members' });
const noAccess = () => screen.findByText("You don't have access");
const rows = () => screen.getAllByRole('row').slice(1);
const rowOf = (name: string): HTMLElement => {
  const row = rows().find((r) => within(r).queryByText(name) !== null);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};
const cells = (row: HTMLElement) => within(row).getAllByRole('cell');
const hasMenu = (name: string) => screen.queryByRole('button', { name: `Actions for ${name}` }) !== null;

/** Records the org's members requests only: the app bar reads other lists. */
async function watchMemberLists<T>(run: () => Promise<T>): Promise<{ result: T; listed: string[] }> {
  const listed: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/orgs/') && pathname.endsWith('/members')) listed.push(request.url);
  };
  server.events.on('request:start', listener);
  try {
    return { result: await run(), listed };
  } finally {
    server.events.removeListener('request:start', listener);
  }
}

describe('members page: rows (BR-1)', () => {
  it('TC-1.1 an owner sees every person with name, handle, role, project roles and the You tag, and no email', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Role',
      'Project roles',
      'Actions',
    ]);
    expect(rows()).toHaveLength(5);
    const alice = rowOf('Alice Doe');
    expect(alice).toHaveTextContent('You');
    expect(cells(alice)[1]).toHaveTextContent('Owner');
    expect(cells(rowOf('Ben Okafor'))[1]).toHaveTextContent('Admin');
    const cleo = rowOf('Cleo Martin');
    expect(cells(cleo)[1]).toHaveTextContent('Member');
    expect(cells(cleo)[2]).toHaveTextContent('invoicer-api (Admin), invoicer-web (Member)');
    const eli = rowOf('Eli Ford');
    expect(cells(eli)[1]).toHaveTextContent('No role');
    expect(cells(eli)[2]).toHaveTextContent('docs-site (Viewer)');
    expect(cells(rowOf('Priya Raman'))[2]).toHaveTextContent('—');
    expect(screen.getByRole('main').textContent).not.toContain('@');
  });

  it('TC-1.2 an admin sees the same people and roles as an owner', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    expect(rows()).toHaveLength(5);
    expect(cells(rowOf('Priya Raman'))[1]).toHaveTextContent('Owner');
    expect(cells(rowOf('Ben Okafor'))[1]).toHaveTextContent('Admin');
    expect(cells(rowOf('Eli Ford'))[1]).toHaveTextContent('No role');
  });

  it('TC-1.3 several owners all show Owner', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(cells(rowOf('Alice Doe'))[1]).toHaveTextContent('Owner');
    expect(cells(rowOf('Priya Raman'))[1]).toHaveTextContent('Owner');
  });

  it('BR-4 an owner has a menu on the other owner row and on an admin row', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(hasMenu('Priya Raman')).toBe(true);
    expect(hasMenu('Ben Okafor')).toBe(true);
  });

  it('TC-9.1 the own row offers Change role and no Remove; another row offers both', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Actions for Alice Doe' }));
    const own = screen.getByRole('dialog', { name: 'Actions for Alice Doe' });
    expect(within(own).getByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Remove from organization' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Ben Okafor' }));
    const other = screen.getByRole('dialog', { name: 'Actions for Ben Okafor' });
    expect(within(other).getByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Remove from organization' })).toBeInTheDocument();
  });

  it("TC-9.2 an admin's own row offers Change role and no Remove", async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Actions for Alice Doe' }));
    const own = screen.getByRole('dialog', { name: 'Actions for Alice Doe' });
    expect(within(own).getByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'Remove from organization' })).not.toBeInTheDocument();
  });

  it('BR-4 an admin has no menu on an owner row and one on every other row', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    expect(hasMenu('Priya Raman')).toBe(false);
    expect(hasMenu('Alice Doe')).toBe(true); // the admin's own row (an admin row): Change role only
    expect(hasMenu('Ben Okafor')).toBe(true);
    expect(hasMenu('Cleo Martin')).toBe(true);
  });

  it('renders a member name as text, never as HTML', async () => {
    await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        const m = mockDb.state.members[mockDb.state.orgs[0]?.id ?? '']?.[1];
        if (m) m.name = '<img src=x alt="pwn">';
      },
    });
    await ready();
    expect(screen.getByRole('main').querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x alt="pwn">')).toBeInTheDocument();
  });
});

describe('members page: paging (BR-1, TC-1.4)', () => {
  afterEach(() => localStorage.clear());

  it('TC-1.4 25 members: page 1 has 20, page 2 has 5 and the URL keeps ?page=2', async () => {
    const { router, user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('membersPaged') });
    await ready();
    expect(rows()).toHaveLength(20);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveTextContent('Showing 1–20 of 25');
    // The control offers Previous, page numbers, Next, Go to page and Rows per page (20, 50, 100).
    const bar = within(nav);
    expect(bar.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(bar.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(bar.getAllByRole('button', { name: 'Page 2' }).length).toBeGreaterThan(0);
    expect(bar.getByRole('textbox', { name: 'Go to page' })).toBeInTheDocument();
    expect(
      within(bar.getByRole('combobox', { name: 'Rows per page' }))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['20', '50', '100']);
    await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–25 of 25'),
    );
    expect(rows()).toHaveLength(5);
    expect(router.state.location.search).toEqual({ page: '2' });
    expect(bar.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(bar.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(rows()).toHaveLength(20));
    expect(router.state.location.search).toEqual({});
    await user.click(bar.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    await user.type(bar.getByRole('textbox', { name: 'Go to page' }), '1{Enter}');
    await waitFor(() => expect(rows()).toHaveLength(20));
  });

  it('Rows per page 50 requests pageSize=50 and shows all 25 members on one page', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('membersPaged') });
    await ready();
    const { listed } = await watchMemberLists(async () => {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
      await waitFor(() => expect(rows()).toHaveLength(25));
    });
    expect(listed.map((u) => new URL(u).searchParams.get('pageSize'))).toContain('50');
  });

  it('opens straight on page 2 with ?page=2', async () => {
    await renderRoute('/o/alice/settings/members?page=2', { scenario: asRole('membersPaged') });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–25 of 25');
  });

  it('a page past the end moves to the last page', async () => {
    const { router } = await renderRoute('/o/alice/settings/members?page=9', { scenario: asRole('membersPaged') });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(router.state.location.search).toEqual({ page: '2' });
  });
});

describe('members page: switching org', () => {
  it("another org's Members URL never shows the previous org's rows while its own list loads", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { router, queryClient } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        // The same person owns a second org whose roster has other people.
        mockDb.state.memberships.push({ userId: ids.user.alice, orgId: ids.org.acme, roleKey: 'owner' });
        mockDb.state.members[ids.org.acme] = (mockDb.state.members[ids.org.alice] ?? []).map((m) => ({
          ...m,
          name: `Acme ${m.name}`,
        }));
      },
    });
    await ready();
    expect(rows()).toHaveLength(5);
    server.use(
      http.get('*/api/orgs/:orgId/members', async ({ params }) => {
        if (params.orgId === ids.org.acme) await held;
        return undefined;
      }),
    );
    try {
      await act(async () => {
        await router.navigate({ to: '/o/$org/settings/members', params: { org: 'acme' } });
      });
      // The other org's projects arrive (so only the members list is pending), then nothing of the first org shows.
      await waitFor(() =>
        expect(queryClient.getQueryState(['org', 'acme', 'invitations', 'projects'])?.status).toBe('success'),
      );
      expect(screen.queryByText('Alice Doe')).not.toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    } finally {
      await act(async () => release());
    }
    expect(await screen.findByText('Acme Alice Doe')).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });
});

describe('members page: loading and error', () => {
  it('shows the loading skeleton while the list is held', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        server.use(
          http.get('*/api/orgs/:orgId/members', async () => {
            await held;
            return undefined;
          }),
        );
      },
    });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    await act(async () => release());
    await ready();
  });

  it('a 500 shows the error with its request id, and Retry fetches again', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('members.list', {
          status: 500,
          title: 'Internal server error',
          type: 'internal',
          requestId: 'req-members-1',
        });
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req-members-1/)).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(rows()).toHaveLength(5);
  });
});

describe('members page: access (BR-2, BR-25)', () => {
  it('rights lost while the page is open: it turns to no-access and requests no further list', async () => {
    const { queryClient } = await renderRoute('/o/alice/settings/members', {
      scenario: asRole('membersPaged'),
    });
    await ready();
    expect(rows()).toHaveLength(20);
    // The owner becomes an admin of one project only (member:read is org level) behind the open page; the grants
    // refresh without a navigation. The settings layout still has the Invitations tab, so the page itself must refuse.
    const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
    if (!seat) throw new Error('no seat');
    seat.roleKey = 'admin';
    seat.projectIds = [ids.project.invoicerApi];
    const { listed } = await watchMemberLists(async () => {
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: orgAccessQuery('alice').queryKey });
      });
      await noAccess();
      expect(screen.getByRole('navigation', { name: 'Organization settings' })).toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
      // A refetch trigger (focus, a mutation elsewhere) must not ask for members either.
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: membersListKey('alice') });
      });
      await noAccess();
    });
    expect(listed).toEqual([]);
  });

  it('BR-2 a project admin typing the URL sees no-access inside the layout and members.list is not fetched', async () => {
    const { listed } = await watchMemberLists(async () => {
      await renderRoute('/o/alice/settings/members', { scenario: asRole('projectAdmin') });
      await noAccess();
      // The settings layout (side menu with Invitations only) is still there.
      expect(
        within(screen.getByRole('navigation', { name: 'Organization settings' }))
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Invitations']);
      expect(screen.queryByRole('heading', { level: 1, name: 'Members' })).not.toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });

  it.each(['member', 'viewer'] as const)(
    'BR-2 a %s sees no-access under the bar and members.list is not fetched',
    async (s) => {
      const { listed } = await watchMemberLists(async () => {
        await renderRoute('/o/alice/settings/members', { scenario: asRole(s) });
        await noAccess();
        expect(screen.queryByRole('navigation', { name: 'Organization settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('row')).not.toBeInTheDocument();
      });
      expect(listed).toEqual([]);
    },
  );

  it("BR-25 another org's slug shows not found and members.list is not fetched", async () => {
    const { listed } = await watchMemberLists(async () => {
      await renderRoute('/o/acme/settings/members', { scenario: asRole('soleOwner') });
      await screen.findByText('Page not found');
    });
    expect(listed).toEqual([]);
  });
});
