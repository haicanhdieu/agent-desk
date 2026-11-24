import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { roleFixtures } from '@/mocks/dto/access';
import { mockDb, type InvitationRow } from '@/mocks/msw/db';
import { problemResponse } from '@/mocks/msw/http';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// Real routes and the real guard of the platform shell; only the data behind the API is the mock. The mock invitation
// handlers answer for the orgs of the sign-in store, so the platform org gets a row there and its own invitations.
const ACME = 'b8000000-0000-4000-8000-000000000001';
const invitationsPath = `/platform/orgs/${ACME}/invitations`;
const DAY = 24 * 60 * 60 * 1000;
const owner = roleFixtures.find((r) => r.key === 'owner');
const member = roleFixtures.find((r) => r.key === 'member');

const invitation = (n: number, email: string, status: InvitationRow['status'], expiresIn = DAY): InvitationRow => {
  if (!member) throw new Error('no member role fixture');
  return {
    id: `b8800000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    orgId: ACME,
    email,
    role: { id: member.id, key: member.key, name: member.name },
    scope: { type: 'org' },
    status,
    expiresAt: new Date(Date.now() + expiresIn).toISOString(),
    invitedBy: { name: 'Alice', handle: 'alice' },
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
    acceptedAt: null,
  };
};

/** One pending and one revoked invitation in the org. */
const seeded = () => {
  scenarios.platform('platformAdminOrgs');
  mockDb.state.orgs.push({
    id: ACME,
    name: 'Acme',
    slug: 'acme',
    logo: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  // The platform scenario seeds its own Acme invitations; this test owns the org's rows.
  mockDb.state.invitations = mockDb.state.invitations.filter((i) => i.orgId !== ACME);
  mockDb.state.invitations.push(
    invitation(1, 'pending@example.test', 'pending'),
    invitation(2, 'gone@example.test', 'revoked'),
  );
};
const emptied = () => {
  scenarios.platform('platformAdminOrgs');
  mockDb.state.invitations = mockDb.state.invitations.filter((i) => i.orgId !== ACME);
  mockDb.state.orgs.push({
    id: ACME,
    name: 'Acme',
    slug: 'acme',
    logo: null,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
};
const ready = () => screen.findByRole('heading', { level: 2, name: 'Invitations' });
const emails = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).queryAllByRole('cell')[0]?.textContent)
    .filter((t) => t !== undefined);
const rowOf = (email: string): HTMLElement => {
  const row = screen.getAllByRole('row').find((r) => within(r).queryByText(email) !== null);
  if (!row) throw new Error(`no row for ${email}`);
  return row;
};
const ownPosts = (): InvitationRow[] => mockDb.state.invitations.filter((i) => i.orgId === ACME);

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

type Rendered = Awaited<ReturnType<typeof renderRoute>>;
const openDialog = async ({ user }: Rendered) => {
  await user.click(screen.getAllByRole('button', { name: 'Invite people' })[0] as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
  await within(dialog).findByRole('option', { name: 'Owner' });
  return dialog;
};
const typeEmail = async ({ user }: Rendered, email: string) => {
  await user.click(screen.getByRole('textbox', { name: 'Email' }));
  await user.paste(email);
};
const submit = ({ user }: Rendered) => user.click(screen.getByRole('button', { name: 'Create invitation' }));
const rowAction = async ({ user }: Rendered, email: string, action: string) => {
  await user.click(within(rowOf(email)).getByRole('button', { name: `Actions for ${email}` }));
  await user.click(await screen.findByRole('button', { name: action }));
};
/** An address of exactly `length` characters whose parts are within the 64 and 63 character limits. */
const emailOfLength = (length: number): string =>
  `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - 64 - 1 - 63 - 1 - 63 - 1)}`;

describe('Platform org Invitations tab', () => {
  it('BR-29: pending by default with the status in the URL; Revoked and All filter', async () => {
    const { user, router } = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    expect(emails()).toEqual(['pending@example.test']);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Email',
      'Role',
      'Access',
      'Status',
      'Expires',
      'Invited by',
      'Actions',
    ]);
    expect(screen.getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Revoked' }));
    await waitFor(() => expect(emails()).toEqual(['gone@example.test']));
    expect(router.state.location.search).toMatchObject({ status: 'revoked' });
    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(emails()).toHaveLength(2));
    expect(router.state.location.search).toMatchObject({ status: 'all' });
  });

  it('BR-30: Invite people with Owner and the whole organization creates a pending row and shows the link', async () => {
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    await openDialog(rendered);
    await typeEmail(rendered, 'new@example.test');
    await rendered.user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'Owner');
    expect(screen.getByRole('radio', { name: 'Whole organization' })).toBeChecked();
    await submit(rendered);
    const link = await screen.findByRole('dialog', { name: 'Invitation link' });
    const created = ownPosts().find((i) => i.email === 'new@example.test');
    expect(created?.role.key).toBe(owner?.key);
    expect(within(link).getByTitle(`${window.location.origin}/invitations/${created?.id}`)).toBeInTheDocument();
    await rendered.user.click(within(link).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(emails()).toContain('new@example.test'));
    expect(within(rowOf('new@example.test')).getByText('Pending')).toBeInTheDocument();
  });

  it('BR-30: resend shows the row busy, then a fresh expiry; the row stays pending', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    const before = ownPosts().find((i) => i.email === 'pending@example.test')?.expiresAt;
    server.use(
      http.post('*/api/platform/orgs/:orgId/invitations/:invitationId/resend', async ({ params }) => {
        await held;
        const row = ownPosts().find((i) => i.id === params['invitationId']);
        if (row) row.expiresAt = new Date(Date.now() + 2 * DAY).toISOString();
        return HttpResponse.json(row);
      }),
    );
    await rowAction(rendered, 'pending@example.test', 'Resend');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions for pending@example.test' })).toBeDisabled(),
    );
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for pending@example.test' })).toBeEnabled());
    expect(ownPosts().find((i) => i.email === 'pending@example.test')?.expiresAt).not.toBe(before);
    await waitFor(() =>
      expect(within(rowOf('pending@example.test')).getByText('Expires in 2 days')).toBeInTheDocument(),
    );
    expect(within(rowOf('pending@example.test')).getByText('Pending')).toBeInTheDocument();
  });

  it('BR-30: revoke with confirm leaves the pending list', async () => {
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    await rowAction(rendered, 'pending@example.test', 'Revoke');
    const dialog = await screen.findByRole('dialog', { name: 'Revoke invitation for pending@example.test?' });
    await rendered.user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Invitation revoked')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('pending@example.test')).not.toBeInTheDocument());
    await rendered.user.click(screen.getByRole('button', { name: 'Revoked' }));
    await waitFor(() => expect(emails()).toContain('pending@example.test'));
  });

  it('BR-31: an empty and a not-an-email address show an error at Email and send nothing', async () => {
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    const before = ownPosts().length;
    await openDialog(rendered);
    await rendered.user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'Owner');
    await submit(rendered);
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    await typeEmail(rendered, 'not-an-email');
    await submit(rendered);
    expect(await screen.findByRole('textbox', { name: 'Email' })).toBeInvalid();
    expect(ownPosts()).toHaveLength(before);
  });

  it('BR-31: a 255 character address is refused and a 254 character one is accepted', async () => {
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    const before = ownPosts().length;
    await openDialog(rendered);
    await rendered.user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'Owner');
    await typeEmail(rendered, emailOfLength(255));
    await submit(rendered);
    expect(await screen.findByText('Use 254 characters or fewer.')).toBeInTheDocument();
    expect(ownPosts()).toHaveLength(before);
    await rendered.user.clear(screen.getByRole('textbox', { name: 'Email' }));
    await typeEmail(rendered, emailOfLength(254));
    await submit(rendered);
    expect(await screen.findByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
    expect(ownPosts()).toHaveLength(before + 1);
  });

  it('a copy failure shows the copy message and the link to copy by hand', async () => {
    const rendered = await renderRoute(invitationsPath, { scenario: seeded });
    await ready();
    // After the render: user-event installs its own clipboard when it is set up.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });
    await rowAction(rendered, 'pending@example.test', 'Copy link');
    expect(await screen.findByText('Could not copy. Select the link and copy it.')).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog', { name: 'Invitation link' });
    expect(
      within(dialog).getByText(new RegExp(`/invitations/${invitation(1, '', 'pending').id}$`)),
    ).toBeInTheDocument();
  });

  it('shows the loading state', async () => {
    server.use(
      http.get('*/api/platform/orgs/:orgId/invitations', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await renderRoute(invitationsPath, { scenario: seeded });
    await screen.findByRole('heading', { level: 1, name: 'Acme' });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('shows the empty state with Invite people', async () => {
    await renderRoute(invitationsPath, { scenario: emptied });
    await ready();
    expect(screen.getByText('No invitations')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Invite people' })).toHaveLength(2);
  });

  it('shows the error state and Retry loads the list', async () => {
    let fail = true;
    server.use(
      http.get('*/api/platform/orgs/:orgId/invitations', () => {
        if (fail) return problemResponse({ status: 500, title: 'Invitations down' });
        return undefined;
      }),
    );
    const { user } = await renderRoute(invitationsPath, { scenario: seeded });
    expect(await screen.findByText('Invitations down')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await ready();
    expect(emails()).toEqual(['pending@example.test']);
  });
});
