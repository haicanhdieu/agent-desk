import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import type { UserEvent } from '@testing-library/user-event';
import { orgAccessQuery } from '@/features/access/queries';
import { membersListKey } from '@/features/members/queries';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { problemResponse } from '@/mocks/msw/http';

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
/** The text of each grant chip of a row ("No role" when there is no org grant). */
const grantsOf = (name: string) =>
  within(rowOf(name))
    .getAllByRole('listitem')
    .map((i) => i.textContent);
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
  it('TC-1.1 an owner sees every person with name, handle, every grant as scope and role, and the You tag, and no email', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Access', 'Actions']);
    expect(rows()).toHaveLength(5);
    const alice = rowOf('Alice Doe');
    expect(alice).toHaveTextContent('You');
    expect(grantsOf('Alice Doe')).toEqual(['Organization · Owner']);
    expect(grantsOf('Ben Okafor')).toEqual(['Organization · Admin']);
    expect(grantsOf('Cleo Martin')).toEqual(['Organization · Member', 'invoicer-api · Admin', 'invoicer-web · Member']);
    expect(grantsOf('Eli Ford')).toEqual(['No role', 'docs-site · Viewer']);
    expect(grantsOf('Priya Raman')).toEqual(['Organization · Owner']);
    expect(screen.getByRole('main').textContent).not.toContain('@');
  });

  it('TC-1.2 an admin sees the same people and roles as an owner', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    expect(rows()).toHaveLength(5);
    expect(grantsOf('Priya Raman')).toEqual(['Organization · Owner']);
    expect(grantsOf('Ben Okafor')).toEqual(['Organization · Admin']);
    expect(grantsOf('Eli Ford')[0]).toBe('No role');
  });

  it('TC-1.3 several owners all show Owner', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(grantsOf('Alice Doe')).toEqual(['Organization · Owner']);
    expect(grantsOf('Priya Raman')).toEqual(['Organization · Owner']);
  });

  it('BR-4 an owner has a menu on the other owner row and on an admin row', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(hasMenu('Priya Raman')).toBe(true);
    expect(hasMenu('Ben Okafor')).toBe(true);
  });

  it('TC-9.1 the own row has no actions at all; another row offers Change role and Remove', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    expect(hasMenu('Alice Doe')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Actions for Ben Okafor' }));
    const other = screen.getByRole('dialog', { name: 'Actions for Ben Okafor' });
    expect(within(other).getByRole('button', { name: 'Change access' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Remove from organization' })).toBeInTheDocument();
  });

  it("TC-9.2 an admin's own row has no actions; another member row still offers Change role", async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    expect(hasMenu('Alice Doe')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    const other = screen.getByRole('dialog', { name: 'Actions for Cleo Martin' });
    expect(within(other).getByRole('button', { name: 'Change access' })).toBeInTheDocument();
  });

  it('BR-4 an admin has no menu on an owner row or on their own row, and one on every other row', async () => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    expect(hasMenu('Priya Raman')).toBe(false);
    expect(hasMenu('Alice Doe')).toBe(false); // the admin's own row: nobody changes their own role
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

  // A dialog opened in one org belongs to that org: the route stays mounted when the slug changes (browser back or
  // forward), so nothing of it may be sent to, or shown for, the other org.
  const twoOrgs = () => {
    applyTenantAdminScenario(mockDb, 'twoOwners');
    mockDb.state.memberships.push({ userId: ids.user.alice, orgId: ids.org.acme, roleKey: 'owner' });
    mockDb.state.members[ids.org.acme] = (mockDb.state.members[ids.org.alice] ?? []).map((m) => ({
      ...m,
      name: `Acme ${m.name}`,
    }));
  };
  const holdFor = (orgId: string) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { wait: (id: unknown) => (id === orgId ? held : undefined), release: () => release() };
  };
  const watchWrites = (): { writes: string[]; stop: () => void } => {
    const writes: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      if (request.method === 'PUT' || request.method === 'DELETE') writes.push(`${request.method} ${request.url}`);
    };
    server.events.on('request:start', listener);
    return { writes, stop: () => server.events.removeListener('request:start', listener) };
  };

  it("a change-role dialog opened in one org closes on another org's URL and never shows that org's roles or member", async () => {
    const { router, user } = await renderRoute('/o/alice/settings/members', { scenario: twoOrgs });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    const roles = holdFor(ids.org.acme);
    server.use(
      http.get('*/api/orgs/:orgId/roles', async ({ params }) => {
        await roles.wait(params.orgId);
        return undefined;
      }),
    );
    const sent = watchWrites();
    try {
      await act(async () => {
        await router.navigate({ to: '/o/$org/settings/members', params: { org: 'acme' } });
      });
      // The other org's list is on screen while its roles are still held.
      expect(await screen.findByText('Acme Cleo Martin')).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
      expect(dialog).not.toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    } finally {
      await act(async () => roles.release());
      sent.stop();
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sent.writes).toEqual([]);
  });

  it("a remove confirm opened in one org closes on another org's URL and cannot remove from that org", async () => {
    const { router, user } = await renderRoute('/o/alice/settings/members', { scenario: twoOrgs });
    await ready();
    await openRemove(user, 'Cleo Martin');
    const list = holdFor(ids.org.acme);
    server.use(
      http.get('*/api/orgs/:orgId/members', async ({ params }) => {
        await list.wait(params.orgId);
        return undefined;
      }),
    );
    const sent = watchWrites();
    try {
      await act(async () => {
        await router.navigate({ to: '/o/$org/settings/members', params: { org: 'acme' } });
      });
      await waitFor(() => expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument());
      expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    } finally {
      await act(async () => list.release());
      sent.stop();
    }
    expect(await screen.findByText('Acme Cleo Martin')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    expect(sent.writes).toEqual([]);
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

// --- Change role and remove (BR-3, BR-5, BR-6, BR-8, BR-36, BR-40, BR-42) ---

const orgRoleOf = (name: string) => grantsOf(name)[0] ?? '';
const rosterOf = (orgId: string) => mockDb.state.members[orgId] ?? [];

async function openChangeRole(user: UserEvent, name: string): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(
    within(screen.getByRole('dialog', { name: `Actions for ${name}` })).getByRole('button', { name: 'Change access' }),
  );
  return screen.findByRole('dialog', { name: `Change access for ${name}` });
}
async function pickRole(user: UserEvent, dialog: HTMLElement, card: string) {
  await user.click(within(dialog).getByRole('radio', { name: card }));
}
const saveRole = (user: UserEvent, dialog: HTMLElement) =>
  user.click(within(dialog).getByRole('button', { name: 'Save access' }));
async function openRemove(user: UserEvent, name: string): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(
    within(screen.getByRole('dialog', { name: `Actions for ${name}` })).getByRole('button', {
      name: 'Remove from organization',
    }),
  );
  return screen.findByRole('dialog', { name: `Remove ${name} from ${orgName()}?` });
}
const orgName = () => mockDb.state.orgs.find((o) => o.id === ids.org.alice)?.name ?? '';

describe('members page: change role (BR-3, BR-4, BR-40)', () => {
  it('TC-3.1 save a new role: toast "Role changed", the dialog closes and the list is fetched again', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    // Member is preselected and Save is disabled until the choice differs (TC-3.4); focus is on the current card.
    expect(within(dialog).getByRole('radio', { name: 'Member' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Member' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Save access' })).toBeDisabled();
    await pickRole(user, dialog, 'Admin');
    expect(within(dialog).getByRole('button', { name: 'Save access' })).toBeEnabled();
    const { listed } = await watchMemberLists(async () => {
      await saveRole(user, dialog);
      expect(await screen.findByText('Role changed')).toBeInTheDocument();
      await waitFor(() => expect(orgRoleOf('Cleo Martin')).toContain('Admin'));
    });
    expect(listed.length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
    // Project roles stay (TC-3.3 on the data side).
    expect(grantsOf('Cleo Martin').slice(1)).toEqual(['invoicer-api · Admin', 'invoicer-web · Member']);
  });

  it('TC-3.3 No role keeps the member and the project roles', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'No role');
    await saveRole(user, dialog);
    await screen.findByText('Role changed');
    await waitFor(() => expect(orgRoleOf('Cleo Martin')).toContain('No role'));
    expect(grantsOf('Cleo Martin').slice(1)).toEqual(['invoicer-api · Admin', 'invoicer-web · Member']);
  });

  it('Escape and Cancel close the dialog without a request and return focus to the row Actions button', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    await openChangeRole(user, 'Cleo Martin');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toHaveFocus();
    const again = await openChangeRole(user, 'Cleo Martin');
    await user.click(within(again).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toHaveFocus();
    expect(orgRoleOf('Cleo Martin')).toContain('Member');
  });

  it('TC-4.1 an admin sees Admin, Member, Viewer and No role, and no Owner card', async () => {
    const admin = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    const adminDialog = await openChangeRole(admin.user, 'Cleo Martin');
    expect(within(adminDialog).queryByRole('radio', { name: 'Owner' })).not.toBeInTheDocument();
    expect(within(adminDialog).getAllByRole('radio')).toHaveLength(4);
  });

  it('TC-4.3 an owner sees Owner, Admin, Member, Viewer and No role', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    expect(within(dialog).getByRole('radio', { name: 'Owner' })).toBeInTheDocument();
  });

  it('TC-40.1 picking Owner shows the note; saving makes the member an owner and keeps the project roles', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    expect(within(dialog).queryByText(/Owners can change or remove every member/)).not.toBeInTheDocument();
    await pickRole(user, dialog, 'Owner');
    expect(
      within(dialog).getByText('Owners can change or remove every member, including other owners.'),
    ).toBeInTheDocument();
    await saveRole(user, dialog);
    await screen.findByText('Role changed');
    await waitFor(() => expect(orgRoleOf('Cleo Martin')).toContain('Owner'));
    expect(grantsOf('Cleo Martin').slice(1)).toEqual(['invoicer-api · Admin', 'invoicer-web · Member']);
  });

  it('roles that cannot be loaded show the problem as an error toast and open no dialog', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('roles.list', { status: 500, title: 'Internal server error', type: 'internal' });
      },
    });
    await ready();
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await user.click(screen.getByRole('button', { name: 'Change access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
  });

  it('while the save is in flight the dialog cannot be closed or saved twice', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let puts = 0;
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    server.use(
      http.put('*/api/orgs/:orgId/members/:userId/role', async () => {
        puts += 1;
        await held;
        return undefined;
      }),
    );
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Admin');
    await saveRole(user, dialog);
    const saving = await within(dialog).findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Change access for Cleo Martin' })).toBeInTheDocument();
    await act(async () => release());
    await screen.findByText('Role changed');
    expect(puts).toBe(1);
  });
});

/** Records the writes the page sends: "PUT /role", "POST /assignments", "DELETE /assignments/:id". */
function recordWrites(): { writes: string[]; stop: () => void } {
  const writes: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET') return;
    if (pathname.endsWith('/role')) writes.push('PUT role');
    else if (pathname.includes('/assignments')) writes.push(`${request.method} assignments`);
  };
  server.events.on('request:start', listener);
  return { writes, stop: () => server.events.removeListener('request:start', listener) };
}
const projectSection = (dialog: HTMLElement) => within(dialog).getByRole('group', { name: 'Project access' });
const projectRowIn = (dialog: HTMLElement, project: string) =>
  within(projectSection(dialog)).getByRole('listitem', { name: project });

describe('members page: change access, project grants (#259)', () => {
  it('shows the project grants of the member in the dialog, each with its role', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    expect(within(projectSection(dialog)).getAllByRole('listitem')).toHaveLength(2);
    const api = within(projectRowIn(dialog, 'invoicer-api')).getByRole('combobox', { name: 'Role in invoicer-api' });
    expect(api).toHaveDisplayValue('Admin');
    const web = within(projectRowIn(dialog, 'invoicer-web')).getByRole('combobox', { name: 'Role in invoicer-web' });
    expect(web).toHaveDisplayValue('Member');
  });

  it('saves a changed, an added and a removed project grant through the assignments routes, and the list shows them', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await user.selectOptions(
      within(projectRowIn(dialog, 'invoicer-web')).getByRole('combobox', { name: 'Role in invoicer-web' }),
      'Viewer',
    );
    await user.click(
      within(projectRowIn(dialog, 'invoicer-api')).getByRole('button', { name: 'Remove access to invoicer-api' }),
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project to add' }), 'docs-site');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Role in the project to add' }), 'Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Add project' }));
    const sent = recordWrites();
    try {
      await saveRole(user, dialog);
      expect(await screen.findByText('Access changed')).toBeInTheDocument();
    } finally {
      sent.stop();
    }
    // only the project grants changed: the org role is not written
    expect(sent.writes).not.toContain('PUT role');
    expect(sent.writes.filter((w) => w === 'POST assignments')).toHaveLength(2);
    expect(sent.writes.filter((w) => w === 'DELETE assignments')).toHaveLength(2);
    await waitFor(() =>
      expect(grantsOf('Cleo Martin')).toEqual(['Organization · Member', 'docs-site · Admin', 'invoicer-web · Viewer']),
    );
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
  });

  it('keeps Save access off until something changed, then on for a project change alone', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    expect(within(dialog).getByRole('button', { name: 'Save access' })).toBeDisabled();
    await user.click(
      within(projectRowIn(dialog, 'invoicer-web')).getByRole('button', { name: 'Remove access to invoicer-web' }),
    );
    expect(within(dialog).getByRole('button', { name: 'Save access' })).toBeEnabled();
  });

  it('changes the org role and a project grant in one save: "Access changed"', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    await user.click(
      within(projectRowIn(dialog, 'invoicer-api')).getByRole('button', { name: 'Remove access to invoicer-api' }),
    );
    const sent = recordWrites();
    try {
      await saveRole(user, dialog);
      expect(await screen.findByText('Access changed')).toBeInTheDocument();
    } finally {
      sent.stop();
    }
    expect(sent.writes).toEqual(['PUT role', 'DELETE assignments']);
    await waitFor(() => expect(grantsOf('Cleo Martin')).toEqual(['Organization · Viewer', 'invoicer-web · Member']));
  });

  it('an admin may change project grants too (assignment:create and assignment:delete at org level)', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    expect(within(dialog).getByRole('combobox', { name: 'Project to add' })).toBeEnabled();
    await user.click(
      within(projectRowIn(dialog, 'invoicer-web')).getByRole('button', { name: 'Remove access to invoicer-web' }),
    );
    await saveRole(user, dialog);
    expect(await screen.findByText('Access changed')).toBeInTheDocument();
    await waitFor(() => expect(grantsOf('Cleo Martin')).toEqual(['Organization · Member', 'invoicer-api · Admin']));
  });

  it('never offers Owner on a project, even to an owner caller', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    const select = within(projectRowIn(dialog, 'invoicer-api')).getByRole('combobox', { name: 'Role in invoicer-api' });
    expect(within(select).queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Owner' })).toBeInTheDocument(); // the org role may be Owner
  });

  it('a refused project grant (the project is gone) closes the dialog with the problem as a toast and reads the list again', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project to add' }), 'docs-site');
    await user.click(within(dialog).getByRole('button', { name: 'Add project' }));
    server.use(
      http.post('*/api/orgs/:orgId/assignments', () =>
        problemResponse({
          status: 422,
          title: 'Project not found',
          type: 'validation',
          errors: [{ pointer: '/scope/projectId', detail: 'this project does not exist in the organization' }],
        }),
      ),
    );
    await saveRole(user, dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
  });

  it('a project grant on a project outside the caller scope is refused: the mock API answers 404 and nothing changes', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Project to add' }), 'docs-site');
    await user.click(within(dialog).getByRole('button', { name: 'Add project' }));
    server.use(
      http.post('*/api/orgs/:orgId/assignments', () =>
        problemResponse({ status: 404, title: 'Project not found', type: 'not-found' }),
      ),
    );
    await saveRole(user, dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
    expect(grantsOf('Cleo Martin')).toEqual(['Organization · Member', 'invoicer-api · Admin', 'invoicer-web · Member']);
  });
});

describe('members page: the caller never changes their own role (NO-3)', () => {
  it.each([
    { scenario: 'twoOwners', who: 'an owner' },
    { scenario: 'soleOwner', who: 'the only owner' },
    { scenario: 'admin', who: 'an admin' },
  ] as const)('$scenario: $who has no Change role on their own row, whatever the role', async ({ scenario }) => {
    await renderRoute('/o/alice/settings/members', { scenario: asRole(scenario) });
    await ready();
    expect(within(rowOf('Alice Doe')).getByText('You')).toBeInTheDocument();
    expect(hasMenu('Alice Doe')).toBe(false);
    expect(within(rowOf('Alice Doe')).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('members page: change role errors (BR-5, BR-8, BR-36)', () => {
  it('TC-8.1 a member removed meanwhile: the dialog closes, the 404 title shows as an error toast, the list drops them', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('memberRemovedMeanwhile') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Admin');
    await saveRole(user, dialog);
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Member is no longer in the organization');
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cleo Martin')).not.toBeInTheDocument());
    expect(rows()).toHaveLength(4);
  });

  it('TC-8.3 a role changed meanwhile is no error: "Role changed" and the list shows the new role', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('roleChangedMeanwhile') });
    await ready();
    expect(orgRoleOf('Cleo Martin')).toContain('Member');
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Admin');
    await saveRole(user, dialog);
    expect(await screen.findByText('Role changed')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(orgRoleOf('Cleo Martin')).toContain('Admin'));
  });

  it('TC-36.1 rights lost behind an open page: the 403 shows a dialog Banner with the request id, then the page is no-access', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    // The owner turns this admin into a member behind the open page: the real permission guard now refuses.
    const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
    if (!seat) throw new Error('no seat');
    seat.roleKey = 'member';
    await saveRole(user, dialog);
    const banner = await within(dialog).findByText("You don't have access");
    expect(banner).toBeInTheDocument();
    expect(within(dialog).getByText(/Request ID: \S+/)).toBeInTheDocument();
    // The refusal stays readable; closing the dialog reads access again and the page turns to no-access.
    expect(screen.getByRole('dialog', { name: 'Change access for Cleo Martin' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Change access for Cleo Martin' })).not.toBeInTheDocument();
    await noAccess();
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
  });

  it('TC-36.1 rights lost before the dialog opens: the role cards load is refused too, yet the dialog opens and Save shows the Banner', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    // The owner turns this admin into a member behind the open page: the roles list and the save are both refused now.
    const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
    if (!seat) throw new Error('no seat');
    seat.roleKey = 'member';
    server.use(
      http.get('*/api/orgs/:orgId/roles', () =>
        problemResponse({ status: 403, title: 'Forbidden', type: 'forbidden' }),
      ),
    );
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    await saveRole(user, dialog);
    expect(await within(dialog).findByText("You don't have access")).toBeInTheDocument();
    expect(within(dialog).getByText(/Request ID: \S+/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Change access for Cleo Martin' })).toBeInTheDocument();
  });

  it.each([
    [403, 'Forbidden', 'forbidden'],
    [500, 'Internal server error', 'internal'],
  ] as const)(
    'cards already read, then a refresh of them answers %i: the dialog stays open and Save shows the Banner',
    async (status, title, type) => {
      const { user, queryClient } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
      await ready();
      const rolesKey = ['org', 'alice', 'invitations', 'roles'];
      await waitFor(() => expect(queryClient.getQueryState(rolesKey)?.status).toBe('success'));
      const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
      if (!seat) throw new Error('no seat');
      seat.roleKey = 'member';
      server.use(http.get('*/api/orgs/:orgId/roles', () => problemResponse({ status, title, type })));
      // The cached cards are stale now, so the dialog refreshes them on open and that refresh fails.
      await queryClient.invalidateQueries({ queryKey: rolesKey });
      const dialog = await openChangeRole(user, 'Cleo Martin');
      await waitFor(() => expect(queryClient.getQueryState(rolesKey)?.status).toBe('error'));
      expect(screen.getByRole('dialog', { name: 'Change access for Cleo Martin' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await pickRole(user, dialog, 'Viewer');
      await saveRole(user, dialog);
      expect(await within(dialog).findByText("You don't have access")).toBeInTheDocument();
    },
  );

  it('a 403 with an explicit request id shows it in the Banner', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('members.updateRole', {
          status: 403,
          title: 'Forbidden',
          type: 'forbidden',
          requestId: 'req-403',
        });
      },
    });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    await saveRole(user, dialog);
    expect(await within(dialog).findByText('Request ID: req-403')).toBeInTheDocument();
  });

  it('a 422 on the role shows its title as an error toast and keeps the dialog open to try again', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('members.updateRole', {
          status: 422,
          title: 'Role not allowed here',
          type: 'validation',
          errors: [{ pointer: '/roleId', detail: 'this role cannot be given at organization level' }],
        });
      },
    });
    await ready();
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    await saveRole(user, dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent('Role not allowed here');
    expect(screen.getByRole('dialog', { name: 'Change access for Cleo Martin' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save access' })).toBeEnabled();
  });

  it('the org-mismatch answer shows the switched-tab toast and keeps the dialog and the choice', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    server.use(
      http.put(
        '*/api/orgs/:orgId/members/:userId/role',
        () => problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' }),
        { once: true },
      ),
    );
    const dialog = await openChangeRole(user, 'Cleo Martin');
    await pickRole(user, dialog, 'Viewer');
    await saveRole(user, dialog);
    expect(await screen.findByRole('alert')).toHaveTextContent(ORG_SWITCHED_MESSAGE);
    expect(within(dialog).queryByText('An organization needs at least one owner.')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Viewer' })).toBeChecked();
    await saveRole(user, dialog);
    expect(await screen.findByText('Role changed')).toBeInTheDocument();
  });
});

describe('members page: remove (BR-6, BR-8, BR-9)', () => {
  it('TC-6.1 confirm text, Remove: toast "<name> removed", the member leaves the list, focus goes to the Members heading', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const confirm = await openRemove(user, 'Cleo Martin');
    expect(confirm).toHaveAccessibleName(`Remove Cleo Martin from ${orgName()}?`);
    expect(within(confirm).getByText(`They lose access to every project in ${orgName()}.`)).toBeInTheDocument();
    expect(
      within(confirm)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancel', 'Remove']);
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Cleo Martin removed')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Cleo Martin/ })).not.toBeInTheDocument();
    expect(await ready()).toHaveFocus();
  });

  it('TC-6.3 Cancel closes the confirm, keeps the member and returns focus to the row Actions button', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const confirm = await openRemove(user, 'Cleo Martin');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toHaveFocus();
  });

  it('TC-6.4 an admin removes a member', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('admin') });
    await ready();
    const confirm = await openRemove(user, 'Cleo Martin');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Cleo Martin removed')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
  });

  it('TC-41.2 an owner removes another owner', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    const confirm = await openRemove(user, 'Priya Raman');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Priya Raman removed')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
  });

  it('while the remove is in flight the confirm cannot be closed or repeated', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let deletes = 0;
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    server.use(
      http.delete('*/api/orgs/:orgId/members/:userId', async () => {
        deletes += 1;
        await held;
        return undefined;
      }),
    );
    const confirm = await openRemove(user, 'Cleo Martin');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await within(confirm).findByRole('button', { name: 'Removing…' })).toBeDisabled();
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: /^Remove / })).toBeInTheDocument();
    await act(async () => release());
    await screen.findByText('Cleo Martin removed');
    expect(deletes).toBe(1);
  });

  it('TC-8.2 a member already removed: the 404 title shows as an error toast, the confirm closes, the list drops them', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('memberRemovedMeanwhile') });
    await ready();
    const confirm = await openRemove(user, 'Cleo Martin');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Member is no longer in the organization');
    expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Cleo Martin')).not.toBeInTheDocument());
  });

  it('BR-5 a 409 last owner on remove shows the problem title as a toast, closes the confirm and fetches the list again', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('members.remove', {
          status: 409,
          title: 'The organization needs at least one owner',
          type: 'conflict',
        });
      },
    });
    await ready();
    const confirm = await openRemove(user, 'Priya Raman');
    const { listed } = await watchMemberLists(async () => {
      await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The organization needs at least one owner');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument());
    });
    await waitFor(() => expect(listed.length).toBeGreaterThan(0));
    expect(rows()).toHaveLength(5);
  });

  it('a 403 on remove shows the refusal as an error toast and fetches access again', async () => {
    const { user, queryClient } = await renderRoute('/o/alice/settings/members', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('members.remove', { status: 403, title: 'Forbidden', type: 'forbidden', requestId: 'req-9' });
      },
    });
    await ready();
    const confirm = await openRemove(user, 'Cleo Martin');
    const before = queryClient.getQueryState(orgAccessQuery('alice').queryKey)?.dataUpdateCount ?? 0;
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
    expect(screen.queryByRole('dialog', { name: /^Remove / })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryState(orgAccessQuery('alice').queryKey)?.dataUpdateCount).toBeGreaterThan(before),
    );
  });

  it('the org-mismatch answer on remove shows the switched-tab toast and keeps the confirm open', async () => {
    const { user } = await renderRoute('/o/alice/settings/members', { scenario: asRole('twoOwners') });
    await ready();
    server.use(
      http.delete(
        '*/api/orgs/:orgId/members/:userId',
        () => problemResponse({ status: 409, title: 'Conflict', type: 'org-mismatch' }),
        { once: true },
      ),
    );
    const confirm = await openRemove(user, 'Cleo Martin');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ORG_SWITCHED_MESSAGE);
    expect(screen.getByRole('dialog', { name: /^Remove / })).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });

  it('removing the only row on the last page shows the previous page', async () => {
    const { user, router } = await renderRoute('/o/alice/settings/members?page=2', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'membersPaged');
        // 21 members: page 2 holds one row.
        mockDb.state.members[ids.org.alice] = rosterOf(ids.org.alice).slice(0, 21);
      },
    });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(1));
    const confirm = await openRemove(user, 'Member 20');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Member 20 removed')).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(20));
    expect(router.state.location.search).toEqual({});
    expect(screen.getByText('Member 19')).toBeInTheDocument();
  });
});
