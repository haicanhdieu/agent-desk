import { act, screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatShortDate } from '@/features/invitations/dates';
import { INVITATIONS_MOCK_NOW } from '@/mocks/dto/invitations';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// The mock invitations expire on fixed dates: pin the clock so their labels do not move.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
const stubClipboard = (writeText: (text: string) => Promise<void>) =>
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

const open = (path: string, scenario: Parameters<typeof scenarios.onboarding>[0]) =>
  renderRoute(path, { scenario: () => scenarios.onboarding(scenario) });

const rowOf = (email: string): HTMLElement => {
  // The signed-in user's own email also shows in the top bar: take the table row.
  const row = screen
    .getAllByText(email, { selector: 'span' })
    .map((el) => el.closest('tr'))
    .find((tr) => tr !== null);
  if (!row) throw new Error(`no row for ${email}`);
  return row;
};
const emails = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent ?? '');
const chip = (name: string) => screen.getByRole('button', { name });
const invitationRow = (email: string) => {
  const row = mockDb.state.invitations.find((i) => i.email === email && i.orgId === ids.org.acme);
  if (!row) throw new Error(`no invitation for ${email}`);
  return row;
};
const menu = async (user: Awaited<ReturnType<typeof renderRoute>>['user'], email: string, item: string) => {
  await user.click(screen.getByRole('button', { name: `Actions for ${email}` }));
  await user.click(await screen.findByRole('button', { name: item }));
};
const ready = () => screen.findByRole('heading', { level: 1, name: 'Invitations' });

describe('org invitations page: filter and paging', () => {
  it('BR-30 defaults to Pending with no status in the URL, paged', async () => {
    const { router, user } = await open('/o/acme/settings/invitations', 'invitationsPaged');
    await ready();
    expect(router.state.location.search).toEqual({});
    expect(chip('Pending')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Email',
      'Role',
      'Access',
      'Status',
      'Expires',
      'Invited by',
      'Actions',
    ]);
    expect(emails()).toHaveLength(20);
    expect(emails().some((e) => e.startsWith('done'))).toBe(false);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 1–20 of 25');

    await user.click(screen.getAllByRole('button', { name: 'Page 2' })[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('21–25 of 25'),
    );
    expect(emails()).toHaveLength(5);
    expect(emails().some((e) => e.startsWith('done'))).toBe(false);
    expect(router.state.location.search).toEqual({ page: '2' });
  });

  it('BR-30 a bad ?status= falls back to Pending', async () => {
    await open('/o/acme/settings/invitations?status=bogus', 'owner');
    await ready();
    expect(chip('Pending')).toHaveAttribute('aria-pressed', 'true');
    expect(emails().sort()).toEqual(['b@x.dev', 'n@x.dev', 'p@x.dev', 'q@x.dev']);
  });

  it('BR-47 a chip updates ?status=, the rows and the page count, and returns to page 1', async () => {
    const { router, user } = await open('/o/acme/settings/invitations?page=2', 'invitationsPaged');
    await ready();
    await waitFor(() => expect(emails()).toHaveLength(5));
    await user.click(chip('Accepted'));
    await waitFor(() => expect(emails().sort()).toEqual(['done1@x.dev', 'done2@x.dev', 'done3@x.dev']));
    expect(router.state.location.search).toEqual({ status: 'accepted' });
    expect(chip('Accepted')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();

    await user.click(chip('All'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1–20 of 28'));
    expect(router.state.location.search).toEqual({ status: 'all' });

    await user.click(chip('Pending'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('1–20 of 25'));
    expect(router.state.location.search).toEqual({});
  });

  it('shows the empty state of a status with no rows', async () => {
    const { user } = await open('/o/acme/settings/invitations', 'invitationChanged');
    await ready();
    await user.click(chip('Declined'));
    expect(await screen.findByRole('heading', { name: 'No declined invitations' })).toBeInTheDocument();
    await user.click(chip('All'));
    await waitFor(() => expect(emails()).toEqual(['p@x.dev']));
  });

  it('shows the error state with Retry when the list fails, then the rows', async () => {
    const { user } = await renderRoute('/o/acme/settings/invitations', {
      scenario: () => {
        scenarios.onboarding('owner');
        scenarios.serverError('invitations.list');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(emails()).toHaveLength(4);
  });

  it('shows the loading state while the first page is held', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderRoute('/o/acme/settings/invitations', {
      scenario: () => {
        scenarios.onboarding('owner');
        server.use(
          http.get('*/api/orgs/:orgId/invitations', async () => {
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
});

describe('org invitations page: empty states (BR-47)', () => {
  it('TC-47.3 and TC-47.4 a status with no rows shows its empty state', async () => {
    const { user } = await open('/o/acme/settings/invitations', 'invitationChanged');
    await ready();
    await user.click(chip('Expired'));
    expect(await screen.findByRole('heading', { name: 'No expired invitations' })).toBeInTheDocument();
    await user.click(chip('Accepted'));
    expect(await screen.findByRole('heading', { name: 'No accepted invitations' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No expired invitations' })).not.toBeInTheDocument();
    await user.click(chip('Revoked'));
    expect(await screen.findByRole('heading', { name: 'No revoked invitations' })).toBeInTheDocument();
  });

  it('TC-47.4 All with no invitations at all shows "No invitations yet"', async () => {
    const { user } = await renderRoute('/o/acme/settings/invitations', {
      scenario: () => {
        scenarios.onboarding('owner');
        mockDb.state.invitations = [];
      },
    });
    await ready();
    expect(await screen.findByRole('heading', { name: 'No pending invitations' })).toBeInTheDocument();
    await user.click(chip('All'));
    expect(await screen.findByRole('heading', { name: 'No invitations yet' })).toBeInTheDocument();
  });
});

describe('org invitations page: access (BR-20)', () => {
  it.each(['member', 'viewer'] as const)('a %s sees the no-access state and nothing is fetched', async (scenario) => {
    const listed: string[] = [];
    const listener = ({ request }: { request: Request }) => {
      // The org's list only: the app bar reads the person's own invitations (/api/me/invitations) for its count.
      const { pathname } = new URL(request.url);
      if (pathname.startsWith('/api/orgs/') && pathname.endsWith('/invitations')) listed.push(request.url);
    };
    server.events.on('request:start', listener);
    try {
      await open('/o/acme/settings/invitations', scenario);
      expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Invite people' })).not.toBeInTheDocument();
      expect(listed).toEqual([]);
    } finally {
      server.events.removeListener('request:start', listener);
    }
  });
});

describe('org invitations page: copy link (BR-33)', () => {
  it('copies <origin>/invitations/<id> and says "Link copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    // user-event installs its own clipboard on setup: stub after it.
    stubClipboard(writeText);
    await menu(user, 'p@x.dev', 'Copy link');
    const id = invitationRow('p@x.dev').id;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invitations/${id}`));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument();
  });

  it('a refused clipboard shows the failure toast and a popover with the link, again after a dismissal', async () => {
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    stubClipboard(() => Promise.reject(new Error('denied')));
    await menu(user, 'p@x.dev', 'Copy link');
    const link = `${window.location.origin}/invitations/${invitationRow('p@x.dev').id}`;
    expect(await screen.findByText('Could not copy. Select the link and copy it.')).toBeInTheDocument();
    const popover = await screen.findByRole('dialog', { name: 'Invitation link' });
    expect(within(popover).getByText(link)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument());
    await menu(user, 'p@x.dev', 'Copy link');
    expect(await screen.findByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
  });
});

describe('org invitations page: resend (BR-18, BR-19, BR-49, BR-50)', () => {
  it('BR-18 renews a pending row and says when it now expires', async () => {
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    const before = invitationRow('p@x.dev').expiresAt;
    await menu(user, 'p@x.dev', 'Resend');
    // The toast formats in the browser's zone, as the route does: build the expected date with the same helper
    // (its zone handling is pinned in dates.test.ts) so this test holds in any zone.
    const renewed = invitationRow('p@x.dev').expiresAt;
    expect(
      await screen.findByText(`Invitation renewed. It now expires on ${formatShortDate(renewed)}.`),
    ).toBeInTheDocument();
    expect(renewed).not.toBe(before);
    expect(renewed).toBe('2026-11-23T12:00:00.000Z');
    await waitFor(() => expect(within(rowOf('p@x.dev')).getByText('Expires in 2 days')).toBeInTheDocument());
    expect(within(rowOf('p@x.dev')).getByText('Pending')).toBeInTheDocument();
  });

  it('TC-18.2 Copy link after a resend yields the same link as before', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    stubClipboard(writeText);
    await menu(user, 'p@x.dev', 'Copy link');
    const link = `${window.location.origin}/invitations/${invitationRow('p@x.dev').id}`;
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(link));
    await menu(user, 'p@x.dev', 'Resend');
    await screen.findByText(/^Invitation renewed\./);
    await waitFor(() => expect(within(rowOf('p@x.dev')).getByText('Expires in 2 days')).toBeInTheDocument());
    await menu(user, 'p@x.dev', 'Copy link');
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(link);
  });

  it('BR-49 an expired row becomes pending with an expiry 2 days out', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=all', 'invitationsExpiry');
    await ready();
    expect(within(rowOf('expired-5d@x.dev')).getByText('Expired')).toBeInTheDocument();
    await menu(user, 'expired-5d@x.dev', 'Resend');
    // `?status=all` because a renewed row leaves the Expired list. The toast date is the new expiry, in the browser's zone.
    const renewed = invitationRow('expired-5d@x.dev').expiresAt;
    expect(
      await screen.findByText(`Invitation renewed. It now expires on ${formatShortDate(renewed)}.`),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('expired-5d@x.dev')).getByText('Pending')).toBeInTheDocument());
    expect(within(rowOf('expired-5d@x.dev')).getByText('Expires in 2 days')).toBeInTheDocument();
  });

  it('BR-19 a row that changed meanwhile: error toast, refetch, the row shows its new status', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=all', 'invitationChanged');
    await ready();
    expect(within(rowOf('p@x.dev')).getByText('Pending')).toBeInTheDocument();
    await menu(user, 'p@x.dev', 'Resend');
    expect(await screen.findByText('Invitation is no longer pending')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('p@x.dev')).getByText('Accepted')).toBeInTheDocument());
    expect(screen.queryByText(/^Invitation renewed/)).not.toBeInTheDocument();
    // Nothing else changed: the one row, one toast.
    expect(emails()).toEqual(['p@x.dev']);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('BR-19 shows the same toast when the API puts the sentence in the detail (title "Conflict")', async () => {
    const { user } = await renderRoute('/o/acme/settings/invitations', {
      scenario: () => {
        scenarios.onboarding('owner');
        scenarios.problem('invitations.resend', {
          status: 409,
          title: 'Conflict',
          type: 'conflict',
          detail: 'Invitation is no longer pending',
        });
      },
    });
    await ready();
    await menu(user, 'p@x.dev', 'Resend');
    expect(await screen.findByText('Invitation is no longer pending')).toBeInTheDocument();
    expect(screen.queryByText('Conflict')).not.toBeInTheDocument();
  });

  it('BR-50 an expired row whose email has a newer pending one: "already invited", the list is unchanged', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=expired', 'invitationsExpiry');
    await ready();
    const expired = mockDb.state.invitations.find((i) => i.email === 'again@x.dev' && i.status === 'expired');
    const pending = mockDb.state.invitations.find((i) => i.email === 'again@x.dev' && i.status === 'pending');
    const pendingBefore = JSON.stringify(pending);
    await menu(user, 'again@x.dev', 'Resend');
    expect(await screen.findByText('This email already has a pending invitation.')).toBeInTheDocument();
    expect(within(rowOf('again@x.dev')).getByText('Expired')).toBeInTheDocument();
    expect(expired?.status).toBe('expired');
    expect(JSON.stringify(pending)).toBe(pendingBefore);
  });
});

describe('org invitations page: revoke (BR-19, BR-32)', () => {
  it('BR-32 confirms, revokes, says "Invitation revoked" and the row shows Revoked', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=all', 'owner');
    await ready();
    await menu(user, 'p@x.dev', 'Revoke');
    const dialog = await screen.findByRole('dialog', { name: 'Revoke invitation for p@x.dev?' });
    expect(within(dialog).getByText('The link stops working.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Invitation revoked')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invitationRow('p@x.dev').status).toBe('revoked');
    await waitFor(() => expect(within(rowOf('p@x.dev')).getByText('Revoked')).toBeInTheDocument());
  });

  it('BR-32 Cancel keeps the row pending and sends nothing', async () => {
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    await menu(user, 'p@x.dev', 'Revoke');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(invitationRow('p@x.dev').status).toBe('pending');
    expect(within(rowOf('p@x.dev')).getByText('Pending')).toBeInTheDocument();
  });

  it('while the request is in flight the button reads "Revoking…" and the dialog cannot be closed', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    server.use(
      http.delete('*/api/orgs/:orgId/invitations/:invitationId', async () => {
        await held;
        return undefined;
      }),
    );
    await menu(user, 'p@x.dev', 'Revoke');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    const busy = await within(dialog).findByRole('button', { name: 'Revoking…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByText('Invitation revoked')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a resend in flight on another row does not make the revoke dialog read "Revoking…" or lock it', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = await open('/o/acme/settings/invitations', 'owner');
    await ready();
    server.use(
      http.post('*/api/orgs/:orgId/invitations/:invitationId/resend', async () => {
        await held;
        return undefined;
      }),
    );
    await menu(user, 'q@x.dev', 'Resend');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for q@x.dev' })).toBeDisabled());
    await menu(user, 'p@x.dev', 'Revoke');
    const dialog = await screen.findByRole('dialog', { name: 'Revoke invitation for p@x.dev?' });
    expect(within(dialog).getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => release());
    expect(await screen.findByText(/^Invitation renewed\./)).toBeInTheDocument();
  });

  it('BR-19 a row that changed meanwhile: error toast, dialog closed, refetch shows the new status', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=all', 'invitationChanged');
    await ready();
    await menu(user, 'p@x.dev', 'Revoke');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    // The spec asks only for "an error Toast" (Q5); its text is the API's problem title.
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation is not pending');
    expect(screen.queryByText('Invitation revoked')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(within(rowOf('p@x.dev')).getByText('Accepted')).toBeInTheDocument());
    // Nothing else changed: the one row, one toast.
    expect(emails()).toEqual(['p@x.dev']);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('BR-19 final rows offer neither Resend nor Revoke; an expired row offers Resend only', async () => {
    const { user } = await open('/o/acme/settings/invitations?status=all', 'owner');
    await ready();
    for (const email of ['a@x.dev', 'd@x.dev', 'r@x.dev']) {
      expect(screen.getByRole('button', { name: `Actions for ${email}` })).toBeDisabled();
    }
    await user.click(screen.getByRole('button', { name: 'Actions for e@x.dev' }));
    expect(await screen.findByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});

describe('org invitations page: columns (BR-51, BR-52)', () => {
  it('BR-51 relative labels with the exact date on hover, exact date past 3 days', async () => {
    // The expiry rows are placed relative to the mock clock.
    vi.setSystemTime(new Date(INVITATIONS_MOCK_NOW));
    await open('/o/acme/settings/invitations?status=all', 'invitationsExpiry');
    await ready();
    const cell = (email: string) => within(rowOf(email)).getAllByRole('cell')[4] as HTMLElement;
    const time = (email: string) => {
      const el = cell(email).querySelector('time');
      if (!el) throw new Error(`no time for ${email}`);
      return el;
    };
    const full = /^\d{1,2} Nov 2026, \d\d:\d\d$/;
    expect(time('in2d@x.dev')).toHaveTextContent('Expires in 2 days');
    expect(time('in2d@x.dev').title).toMatch(full);
    expect(time('in5h@x.dev')).toHaveTextContent('Expires in 5 hours');
    expect(time('in5h@x.dev').title).toMatch(full);
    // TC-51.3: the row that expired 1 day ago. Its email is also on a pending row, so find it by its expiry.
    const dayAgo = new Date(Date.parse(INVITATIONS_MOCK_NOW) - 24 * 3_600_000).toISOString();
    const dayAgoTime = document.querySelector<HTMLTimeElement>(`time[datetime="${dayAgo}"]`);
    if (!dayAgoTime) throw new Error('no row expired 1 day ago');
    expect(dayAgoTime).toHaveTextContent('Expired 1 day ago');
    expect(dayAgoTime.title).toMatch(full);
    expect(time('expired-2d23h@x.dev')).toHaveTextContent('Expired 2 days ago');
    expect(time('expired-3d@x.dev')).toHaveTextContent('Expired 3 days ago');
    expect(time('expired-3d@x.dev').title).toMatch(full);
    for (const email of ['expired-3d1h@x.dev', 'expired-5d@x.dev']) {
      expect(time(email).textContent).toMatch(/^\d{1,2} Nov, \d\d:\d\d$/);
      expect(time(email).title).toMatch(full);
    }
  });

  it('BR-52 shows the inviter name as given and a dash when the inviter is gone', async () => {
    await open('/o/acme/settings/invitations', 'owner');
    await ready();
    const by = (email: string) => within(rowOf(email)).getAllByRole('cell')[5]?.textContent;
    expect(by('p@x.dev')).toBe('Ada Lovelace');
    expect(by('b@x.dev')).toBe('bob');
    expect(by('n@x.dev')).toBe('–');
  });
});

describe('org invitations page: switching org on the same route', () => {
  it("never shows one org's rows under another org while that org's list is loading", async () => {
    const { router } = await open('/o/acme/settings/invitations', 'invitationsExpiry');
    await ready();
    expect(emails().length).toBeGreaterThan(1);
    expect(screen.getAllByText('soon@x.dev').length).toBeGreaterThan(0);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/api/orgs/:orgId/invitations', async ({ params }) => {
        if (params.orgId === ids.org.alice) await held;
        return undefined;
      }),
    );
    try {
      await act(async () => {
        await router.navigate({ to: '/o/$org/settings/invitations', params: { org: 'alice' } });
      });
      await waitFor(() => expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument());
      expect(screen.queryByText('soon@x.dev')).not.toBeInTheDocument();
      expect(screen.queryByRole('row')).not.toBeInTheDocument();
    } finally {
      await act(async () => release());
    }
    await waitFor(() => expect(emails()).toHaveLength(1));
  });
});
