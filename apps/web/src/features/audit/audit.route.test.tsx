import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orgAccessQuery } from '@/features/access/queries';
import { auditListKey } from '@/features/audit/queries';
import { AUDIT_MOCK_NOW } from '@/mocks/dto/audit';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { applyTenantAdminScenario, type TenantAdminScenario } from '@/mocks/msw/tenantAdminScenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes, real `can()` over the mock API's grants; only the data behind the API is faked. The clock is pinned to
// the fixtures' "now" so the relative times are stable.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(AUDIT_MOCK_NOW) });
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const asRole = (scenario: TenantAdminScenario) => () => applyTenantAdminScenario(mockDb, scenario);
const ready = () => screen.findByRole('heading', { level: 1, name: 'Audit log' });
const noAccess = () => screen.findByText("You don't have access");
const rows = () => screen.getAllByRole('row').slice(1);

/** Records the org's audit requests only: the app bar reads other lists. */
async function watchAudit<T>(run: () => Promise<T>): Promise<{ result: T; listed: string[] }> {
  const listed: string[] = [];
  const listener = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/orgs/') && pathname.endsWith('/audit')) listed.push(request.url);
  };
  server.events.on('request:start', listener);
  try {
    return { result: await run(), listed };
  } finally {
    server.events.removeListener('request:start', listener);
  }
}

describe('audit page: rows (BR-20)', () => {
  it('TC-20.1 (columns and order only) an owner sees the log newest first under When, Who and What', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('twoOwners') });
    await ready();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['When', 'Who', 'What']);
    expect(rows()).toHaveLength(10);
    const first = within(rows()[0] as HTMLElement).getAllByRole('cell');
    expect(first[0]).toHaveTextContent('2 min ago');
    expect(first[1]).toHaveTextContent('Alice Doe');
    expect(first[2]).toHaveTextContent("Alice Doe changed Cleo Martin's role from Admin to Member");
    const times = rows().map((r) => r.querySelector('time')?.dateTime ?? '');
    expect(times).toEqual([...times].sort().reverse());
  });

  it('TC-20.2 an org admin sees the same entries', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('admin') });
    await ready();
    expect(rows()).toHaveLength(10);
    expect(screen.getByText('/o/harbor-labs')).toBeInTheDocument();
  });

  it('TC-20.4 an entry whose actor was deleted shows the Deleted user tag', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('twoOwners') });
    await ready();
    const row = rows().find((r) => within(r).queryByText('Deleted user') !== null);
    expect(row).toBeDefined();
  });

  it('TC-20.5 a platform admin entry shows the name with the Platform admin tag', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('twoOwners') });
    await ready();
    const row = rows().find((r) => within(r).queryByText('Platform admin') !== null);
    expect(within(row as HTMLElement).getAllByRole('cell')[1]).toHaveTextContent('Pat Platform');
  });

  it('TC-20.6 text with HTML shows literally and nothing is bold or a link beyond the strong parts', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('twoOwners') });
    await ready();
    const main = screen.getByRole('main');
    expect(main.textContent).toContain('<b>long-invitee-');
    expect(main.querySelector('a')).toBeNull();
    // The only <b> elements are the strong parts, whose text is the literal string.
    for (const b of Array.from(main.querySelectorAll('b'))) expect(b.querySelector('b')).toBeNull();
    expect(Array.from(main.querySelectorAll('b')).some((b) => b.textContent === 'long-invitee-')).toBe(false);
  });

  it('TC-20.7 a generic request entry shows its raw key in mono and the When cell has the exact date on hover', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('twoOwners') });
    await ready();
    const raw = screen.getByText('POST orgs.create');
    expect(raw).toHaveClass('mono');
    const time = within(rows()[0] as HTMLElement)
      .getByText('2 min ago')
      .closest('time');
    expect(time).toHaveAttribute('title', expect.stringMatching(/^\d{1,2} Nov 2026, \d{2}:\d{2}$/));
  });
});

describe('audit page: paging (BR-20, TC-20.3)', () => {
  it('TC-20.3 25 entries: page 1 has the 20 newest, page 2 the 5 oldest with "Showing 21–25 of 25"', async () => {
    const { router, user } = await renderRoute('/o/alice/settings/audit', { scenario: asRole('auditPaged') });
    await ready();
    expect(rows()).toHaveLength(20);
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(nav).toHaveTextContent('Showing 1–20 of 25');
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
    expect(screen.getByText('Member 25')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–25 of 25'),
    );
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('Member 1')).toBeInTheDocument();
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

  it('Rows per page 50 requests pageSize=50 and shows all 25 entries on one page', async () => {
    const { user } = await renderRoute('/o/alice/settings/audit', { scenario: asRole('auditPaged') });
    await ready();
    const { listed } = await watchAudit(async () => {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Rows per page' }), '50');
      await waitFor(() => expect(rows()).toHaveLength(25));
    });
    expect(listed.map((u) => new URL(u).searchParams.get('pageSize'))).toContain('50');
  });

  it('opens straight on page 2 with ?page=2', async () => {
    await renderRoute('/o/alice/settings/audit?page=2', { scenario: asRole('auditPaged') });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–25 of 25');
  });

  it('a page past the end moves to the last page', async () => {
    const { router } = await renderRoute('/o/alice/settings/audit?page=9', { scenario: asRole('auditPaged') });
    await ready();
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(router.state.location.search).toEqual({ page: '2' });
  });
});

describe('audit page: loading, error and empty (BR-24)', () => {
  it('TC-24.3 a skeleton shows while the list is held', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute('/o/alice/settings/audit', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        server.use(
          http.get('*/api/orgs/:orgId/audit', async () => {
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

  it('TC-24.4 a failure shows the error with its request id and Retry shows the list', async () => {
    const { user } = await renderRoute('/o/alice/settings/audit', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        scenarios.problem('audit.list', {
          status: 500,
          title: 'Internal server error',
          type: 'internal',
          requestId: 'req-audit-1',
        });
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req-audit-1/)).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(rows()).toHaveLength(10);
  });

  it('TC-24.5 no entries shows "No activity yet"', async () => {
    await renderRoute('/o/alice/settings/audit', { scenario: asRole('auditEmpty') });
    await ready();
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Alice/ })).not.toBeInTheDocument();
  });
});

describe('audit page: switching org (BR-25)', () => {
  it("another org's Audit URL never shows the previous org's rows while its own list loads", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { router, queryClient } = await renderRoute('/o/alice/settings/audit', {
      scenario: () => {
        applyTenantAdminScenario(mockDb, 'twoOwners');
        mockDb.state.memberships.push({ userId: ids.user.alice, orgId: ids.org.acme, roleKey: 'owner' });
        mockDb.state.audit[ids.org.acme] = [
          {
            id: 'b5300000-0000-4000-8000-000000000001',
            at: AUDIT_MOCK_NOW,
            actor: { userId: ids.user.alice, name: 'Alice Doe', handle: 'alice' },
            actorKind: 'member',
            action: 'member.role_changed',
            target: { type: 'user', id: 'x', label: 'Acme Person' },
            changes: [{ field: 'role', from: 'Member', to: 'Admin' }],
          },
        ];
      },
    });
    await ready();
    expect(rows()).toHaveLength(10);
    server.use(
      http.get('*/api/orgs/:orgId/audit', async ({ params }) => {
        if (params.orgId === ids.org.acme) await held;
        return undefined;
      }),
    );
    try {
      await act(async () => {
        await router.navigate({ to: '/o/$org/settings/audit', params: { org: 'acme' } });
      });
      await waitFor(() => expect(queryClient.getQueryState(['org', 'acme', 'access'])?.status).toBe('success'));
      expect(screen.queryByText('Cleo Martin')).not.toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    } finally {
      await act(async () => release());
    }
    expect(await screen.findByText('Acme Person')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });
});

describe('audit page: access (BR-2, BR-25)', () => {
  it('rights lost while the page is open: it turns to no-access and requests no further list', async () => {
    const { queryClient } = await renderRoute('/o/alice/settings/audit', { scenario: asRole('auditPaged') });
    await ready();
    expect(rows()).toHaveLength(20);
    // The owner becomes an admin of one project only (audit:read is org level) behind the open page.
    const seat = mockDb.state.memberships.find((m) => m.userId === ids.user.alice && m.orgId === ids.org.alice);
    if (!seat) throw new Error('no seat');
    seat.roleKey = 'admin';
    seat.projectIds = [ids.project.invoicerApi];
    const { listed } = await watchAudit(async () => {
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: orgAccessQuery('alice').queryKey });
      });
      await noAccess();
      expect(screen.getByRole('navigation', { name: 'Organization settings' })).toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: auditListKey('alice') });
      });
      await noAccess();
    });
    expect(listed).toEqual([]);
  });

  it('BR-2 a project admin typing the URL sees no-access inside the layout and audit.list is not fetched', async () => {
    const { listed } = await watchAudit(async () => {
      await renderRoute('/o/alice/settings/audit', { scenario: asRole('projectAdmin') });
      await noAccess();
      expect(
        within(screen.getByRole('navigation', { name: 'Organization settings' }))
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Invitations']);
      expect(screen.queryByRole('heading', { level: 1, name: 'Audit log' })).not.toBeInTheDocument();
    });
    expect(listed).toEqual([]);
  });

  it.each(['member', 'viewer'] as const)(
    'BR-2 a %s sees no-access under the bar and audit.list is not fetched',
    async (s) => {
      const { listed } = await watchAudit(async () => {
        await renderRoute('/o/alice/settings/audit', { scenario: asRole(s) });
        await noAccess();
        expect(screen.queryByRole('navigation', { name: 'Organization settings' })).not.toBeInTheDocument();
        expect(screen.queryByRole('row')).not.toBeInTheDocument();
      });
      expect(listed).toEqual([]);
    },
  );

  it("BR-25 another org's slug shows not found and audit.list is not fetched", async () => {
    const { listed } = await watchAudit(async () => {
      await renderRoute('/o/acme/settings/audit', { scenario: asRole('soleOwner') });
      await screen.findByText('Page not found');
    });
    expect(listed).toEqual([]);
  });
});
