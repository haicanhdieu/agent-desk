import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  invitationCards,
  invitationDetails,
  orgInvitationRows,
  orgSwitchFixtures,
  pagedInvitationRows,
  user,
} from '@/mocks';
import { InvitationAccept, type InvitationAcceptState } from './InvitationAccept';
import { OrgInvitations, type OrgInvitationsProps } from './OrgInvitations';
import { MyInvitations, type MyInvitationsState } from './MyInvitations';
import { CreateOrg, type CreateOrgState, type CreateOrgValues } from './CreateOrg';
import { OrgSettingsFrame } from './orgSettingsFrame';
import { SignOutProvider } from '@/components';

const settingsOrg = { ...orgSwitchFixtures.oneOrgSettings, orgHref: () => '/o/acme/projects', createHref: '/orgs/new' };

const props = (state: MyInvitationsState) => ({
  user,
  state,
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onSignOut: vi.fn(),
});

describe('MyInvitations', () => {
  it('BR-37: a non-admin with no invitation sees the welcome copy and Sign out, no Create organization', async () => {
    const p = props({ kind: 'empty', email: 'dana.ortiz@example.com', platformAdmin: false, createHref: '/orgs/new' });
    render(<MyInvitations {...p} />);
    expect(
      screen.getByRole('heading', { level: 1, name: "You're not a member of any organization" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No invitations for dana.ortiz@example.com. Ask an owner or admin to invite you.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Create organization/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(p.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('BR-34: a platform admin sees Create organization linking to createHref, and Sign out', () => {
    render(
      <MyInvitations
        {...props({ kind: 'empty', email: 'ops@example.com', platformAdmin: true, createHref: '/orgs/new' })}
      />,
    );
    expect(screen.getByText('Create an organization and invite its first owner.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', '/orgs/new');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('lists one card per invitation under an Invitations heading and wires Accept and Decline by id', async () => {
    const p = props({ kind: 'list', cards: invitationCards, pending: null });
    render(<MyInvitations {...p} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(invitationCards.length);
    const second = screen.getAllByRole('listitem')[1];
    await userEvent.click(within(second).getByRole('button', { name: 'Accept' }));
    await userEvent.click(within(second).getByRole('button', { name: 'Decline' }));
    expect(p.onAccept).toHaveBeenCalledWith(invitationCards[1].id);
    expect(p.onDecline).toHaveBeenCalledWith(invitationCards[1].id);
  });

  it('shows Accepting… on the pressed card only and disables its buttons', () => {
    render(
      <MyInvitations
        {...props({ kind: 'list', cards: invitationCards, pending: { id: invitationCards[0].id, action: 'accept' } })}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByRole('button', { name: 'Accepting…' })).toBeDisabled();
    expect(within(items[0]).getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(within(items[1]).getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  it('renders the loading state as a busy status', () => {
    render(<MyInvitations {...props({ kind: 'loading' })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the error with its request id and retries', async () => {
    const onRetry = vi.fn();
    render(<MyInvitations {...props({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry })} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req_01JD7Q3M8V2K/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has one main landmark and renders names as text, not markup', () => {
    const evil = { ...invitationCards[0], orgName: '<b>x</b>' };
    render(<MyInvitations {...props({ kind: 'list', cards: [evil], pending: null })} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByText(/<b>x<\/b> invited you/)).toBeInTheDocument();
  });
});

const accept = (state: InvitationAcceptState) => ({
  user,
  state,
  onAccept: vi.fn(),
  onDecline: vi.fn(),
  onConfirmDecline: vi.fn(),
  onCancelDecline: vi.fn(),
  onSignOut: vi.fn(),
});
const pending = (over: Partial<Extract<InvitationAcceptState, { kind: 'pending' }>> = {}): InvitationAcceptState => ({
  kind: 'pending',
  details: invitationDetails.pending,
  busy: null,
  confirmDecline: false,
  ...over,
});
const noButtons = () => {
  expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
};

describe('InvitationAccept', () => {
  it('BR-25: pending shows the org, role, access, inviter and expiry with Accept before Decline', async () => {
    const p = accept(pending());
    render(<InvitationAccept {...p} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Join Acme' })).toBeInTheDocument();
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['Role', 'Access', 'Invited by', 'Expires']);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('23 Nov, 14:05')).toHaveAttribute('title', '23 Nov 2026, 14:05');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('Accept')).toBeLessThan(buttons.indexOf('Decline'));
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(p.onAccept).toHaveBeenCalledTimes(1);
    expect(p.onDecline).toHaveBeenCalledTimes(1);
  });

  it('BR-52: pending with no inviter drops the Invited by row but keeps the expiry', () => {
    render(<InvitationAccept {...accept(pending({ details: { ...invitationDetails.pending, inviter: null } }))} />);
    expect(screen.queryByText('Invited by')).not.toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
  });

  it('shows Accepting… disabled with Decline disabled while accepting', () => {
    render(<InvitationAccept {...accept(pending({ busy: 'accept' }))} />);
    expect(screen.getByRole('button', { name: 'Accepting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
  });

  it('Decline confirm: copy, Cancel and Decline wired, and Declining… disables both', async () => {
    const p = accept(pending({ confirmDecline: true }));
    const { rerender } = render(<InvitationAccept {...p} />);
    const dialog = screen.getByRole('dialog', { name: 'Decline invitation to Acme?' });
    expect(within(dialog).getByText('You will need a new invitation to join later.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(p.onCancelDecline).toHaveBeenCalledTimes(1);
    expect(p.onConfirmDecline).toHaveBeenCalledTimes(1);
    rerender(<InvitationAccept {...accept(pending({ confirmDecline: true, busy: 'decline' }))} />);
    const busy = screen.getByRole('dialog');
    expect(within(busy).getByRole('button', { name: 'Declining…' })).toBeDisabled();
    expect(within(busy).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('BR-22: while declining, Escape does not dismiss the confirm', async () => {
    const p = accept(pending({ confirmDecline: true, busy: 'decline' }));
    render(<InvitationAccept {...p} />);
    await userEvent.keyboard('{Escape}');
    expect(p.onCancelDecline).not.toHaveBeenCalled();
  });

  it('Escape still cancels the decline confirm when not busy', async () => {
    const p = accept(pending({ confirmDecline: true }));
    render(<InvitationAccept {...p} />);
    await userEvent.keyboard('{Escape}');
    expect(p.onCancelDecline).toHaveBeenCalledTimes(1);
  });

  it('accepted with an org shows the org name as plain text in the top bar, and not without it', () => {
    const state: InvitationAcceptState = { kind: 'accepted', orgName: 'Acme', orgHref: '/o/acme/projects' };
    const { unmount } = render(<InvitationAccept {...accept(state)} />);
    expect(within(screen.getByRole('banner')).queryByText('Acme')).not.toBeInTheDocument();
    unmount();
    const org = { ...orgSwitchFixtures.oneOrg, orgHref: () => '/o/acme/projects', createHref: '/orgs/new' };
    render(<InvitationAccept {...accept(state)} org={org} />);
    const bar = within(screen.getByRole('banner'));
    expect(bar.getByText('Acme')).toBeInTheDocument();
    expect(bar.queryByRole('link', { name: 'Acme' })).not.toBeInTheDocument();
  });

  it('BR-26: accepted shows "You already joined <Org>" with a link and no Accept or Decline', () => {
    render(<InvitationAccept {...accept({ kind: 'accepted', orgName: 'Acme', orgHref: '/o/acme/projects' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'You already joined Acme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Acme' })).toHaveAttribute('href', '/o/acme/projects');
    noButtons();
  });

  it('BR-26: declined shows its copy and a Go to invitations link, no Accept or Decline', () => {
    render(<InvitationAccept {...accept({ kind: 'declined', invitationsHref: '/invitations' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'You declined this invitation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to invitations' })).toHaveAttribute('href', '/invitations');
    noButtons();
  });

  it('BR-26: revoked shows its copy and no Accept or Decline', () => {
    render(<InvitationAccept {...accept({ kind: 'revoked' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This invitation was revoked' })).toBeInTheDocument();
    noButtons();
  });

  it('BR-26: expired names the inviter and offers no Accept or Decline', () => {
    render(<InvitationAccept {...accept({ kind: 'expired', orgName: 'Acme', inviter: 'Ada Lovelace' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This invitation has expired' })).toBeInTheDocument();
    expect(screen.getByText('Ask Ada Lovelace to resend it.')).toBeInTheDocument();
    noButtons();
  });

  it('BR-52: expired with a null inviter asks an owner or admin of the org', () => {
    render(<InvitationAccept {...accept({ kind: 'expired', orgName: 'Acme', inviter: null })} />);
    expect(screen.getByText('Ask an owner or admin of Acme to resend it.')).toBeInTheDocument();
  });

  it('BR-5: not available shows no org, role or invitation email, only Signed in as and Sign out', async () => {
    const p = accept({ kind: 'notAvailable', email: 'jo.marsh@example.org' });
    render(<InvitationAccept {...p} />);
    expect(screen.getByRole('heading', { level: 1, name: 'This invitation is not available' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as jo.marsh@example.org')).toBeInTheDocument();
    expect(screen.queryByText(/Acme|Member|Role/)).not.toBeInTheDocument();
    noButtons();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(p.onSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders loading as a busy status with no heading', () => {
    render(<InvitationAccept {...accept({ kind: 'loading' })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders the error with its request id and retries', async () => {
    const onRetry = vi.fn();
    render(<InvitationAccept {...accept({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry })} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req_01JD7Q3M8V2K/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an org name with markup as text', () => {
    const evil = { ...invitationDetails.pending, orgName: '<img src=x>' };
    render(<InvitationAccept {...accept(pending({ details: evil }))} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Join <img src=x>' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

const listProps = (over: Partial<OrgInvitationsProps> = {}): OrgInvitationsProps => ({
  filter: 'pending',
  onFilterChange: vi.fn(),
  state: { kind: 'ready', rows: orgInvitationRows, busyRowId: null },
  onInvite: vi.fn(),
  onCopy: vi.fn(),
  onResend: vi.fn(),
  onRevoke: vi.fn(),
  ...over,
});

describe('OrgInvitations', () => {
  it('openMenuRowId opens a pending row menu with Copy link, Resend and Revoke', async () => {
    const pending = orgInvitationRows.find((r) => r.status === 'pending');
    if (!pending) throw new Error('fixture has no pending row');
    render(<OrgInvitations {...listProps({ openMenuRowId: pending.id })} />);
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('openMenuRowId opens an expired row menu with Resend only', async () => {
    const expired = orgInvitationRows.find((r) => r.status === 'expired');
    if (!expired) throw new Error('fixture has no expired row');
    render(<OrgInvitations {...listProps({ openMenuRowId: expired.id })} />);
    expect(await screen.findByRole('button', { name: 'Resend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('BR-30: the Pending chip is pressed for the pending filter, with no counts, under Filter by status', () => {
    render(<OrgInvitations {...listProps()} />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Pending', 'Accepted', 'Declined', 'Revoked', 'Expired', 'All']);
    expect(within(group).getByRole('button', { name: 'Pending' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('BR-47: picking a chip reports that filter', async () => {
    const p = listProps();
    render(<OrgInvitations {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expired' }));
    expect(p.onFilterChange).toHaveBeenCalledWith('expired');
  });

  it('shows the h1, Invite people and the seven columns', async () => {
    const p = listProps();
    render(<OrgInvitations {...p} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Email',
      'Role',
      'Access',
      'Status',
      'Expires',
      'Invited by',
      'Actions',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    expect(p.onInvite).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pending', 'No pending invitations'],
    ['accepted', 'No accepted invitations'],
    ['declined', 'No declined invitations'],
    ['revoked', 'No revoked invitations'],
    ['expired', 'No expired invitations'],
    ['all', 'No invitations yet'],
  ] as const)('the %s filter with no rows reads "%s"', (filter, copy) => {
    render(<OrgInvitations {...listProps({ filter, state: { kind: 'ready', rows: [], busyRowId: null } })} />);
    expect(screen.getByRole('heading', { name: copy })).toBeInTheDocument();
    expect(screen.queryAllByRole('row')).toHaveLength(1);
  });

  it('the pending empty state offers Invite people, the others do not', async () => {
    const p = listProps({ state: { kind: 'ready', rows: [], busyRowId: null } });
    const { rerender } = render(<OrgInvitations {...p} />);
    expect(screen.getAllByRole('button', { name: 'Invite people' })).toHaveLength(2);
    rerender(<OrgInvitations {...p} filter="declined" />);
    expect(screen.getAllByRole('button', { name: 'Invite people' })).toHaveLength(1);
  });

  it('the forbidden state shows "You don\'t have access" and no rows', () => {
    render(<OrgInvitations {...listProps({ state: { kind: 'forbidden' } })} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner of this organization to give you access.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite people' })).not.toBeInTheDocument();
  });

  it('the loading state is a busy status with no table', () => {
    render(<OrgInvitations {...listProps({ state: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('the error state shows the request ID and Retry', async () => {
    const onRetry = vi.fn();
    render(<OrgInvitations {...listProps({ state: { kind: 'error', requestId: 'req_1', onRetry } })} />);
    expect(screen.getByText(/Request ID: req_1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('a busy row has a disabled menu button, the others do not', () => {
    const busy = orgInvitationRows[0];
    render(
      <OrgInvitations {...listProps({ state: { kind: 'ready', rows: orgInvitationRows, busyRowId: busy.id } })} />,
    );
    expect(screen.getByRole('button', { name: `Actions for ${busy.email}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Actions for ${orgInvitationRows[1].email}` })).toBeEnabled();
  });

  it('a row menu action reports the row id', async () => {
    const p = listProps();
    render(<OrgInvitations {...p} />);
    await userEvent.click(screen.getByRole('button', { name: `Actions for ${orgInvitationRows[0].email}` }));
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(p.onRevoke).toHaveBeenCalledWith(orgInvitationRows[0].id);
  });

  it('renders the pager under the table when given', () => {
    const rows = pagedInvitationRows(5);
    render(
      <OrgInvitations
        {...listProps({
          state: {
            kind: 'ready',
            rows,
            busyRowId: null,
            pagination: { page: 2, pageSize: 20, total: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() },
          },
        })}
      />,
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('an email with markup renders as text', () => {
    const rows = [{ ...orgInvitationRows[0], email: '<img src=x>@example.com' }];
    const { container } = render(
      <OrgInvitations {...listProps({ state: { kind: 'ready', rows, busyRowId: null } })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x>@example.com')).toBeInTheDocument();
  });
});

describe('OrgInvitations actions', () => {
  const target = orgInvitationRows[0];

  it('BR-18: the revoke confirm names the email and its Cancel and Revoke buttons call their handlers', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<OrgInvitations {...listProps({ revokeConfirm: { email: target.email, onConfirm, onCancel } })} />);
    const dialog = screen.getByRole('dialog', { name: `Revoke invitation for ${target.email}?` });
    expect(within(dialog).getByText('The link stops working.')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('no revoke confirm shows unless asked for', () => {
    render(<OrgInvitations {...listProps()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('while the revoke is in flight the confirm cannot be closed or repeated', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <OrgInvitations
        {...listProps({
          state: { kind: 'ready', rows: orgInvitationRows, busyRowId: target.id },
          revokeConfirm: { email: target.email, busy: true, onConfirm, onCancel },
        })}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: `Revoke invitation for ${target.email}?` });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Revoking…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('BR-33: a copy failure shows the "Invitation link" field holding the link, anchored to that row', () => {
    const link = 'https://agentdesk.example/invitations/abc';
    render(<OrgInvitations {...listProps({ copyFailed: { rowId: target.id, link } })} />);
    const pop = screen.getByRole('dialog', { name: 'Invitation link' });
    expect(within(pop).getByText(link)).toBeInTheDocument();
    expect(within(pop).getByText('Invitation link')).toBeInTheDocument();
  });

  it("BR-33: the copy-failed popover sits under that row's Actions button", () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const at = this.getAttribute('aria-label') === `Actions for ${target.email}`;
      return {
        top: 0,
        bottom: at ? 300 : 0,
        left: 0,
        right: at ? 900 : 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
    try {
      render(
        <OrgInvitations {...listProps({ copyFailed: { rowId: target.id, link: 'https://agentdesk.example/i/a' } })} />,
      );
      const pop = screen.getByRole('dialog', { name: 'Invitation link' });
      expect(pop.style.top).toBe('304px');
      expect(pop.style.right).toBe(`${window.innerWidth - 900}px`);
    } finally {
      spy.mockRestore();
    }
  });

  it('no copy-failed popover shows for a row that is not in the list', () => {
    render(<OrgInvitations {...listProps({ copyFailed: { rowId: 'nope', link: 'https://agentdesk.example/i/a' } })} />);
    expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument();
  });

  it('Escape closes the copy-failed popover', async () => {
    render(
      <OrgInvitations {...listProps({ copyFailed: { rowId: target.id, link: 'https://agentdesk.example/i/a' } })} />,
    );
    expect(screen.getByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument();
  });

  it('a repeat copy failure re-shows the popover after it was dismissed, once the route cleared copyFailed in between', async () => {
    const copyFailed = { rowId: target.id, link: 'https://agentdesk.example/i/a' };
    const { rerender } = render(<OrgInvitations {...listProps({ copyFailed })} />);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument();
    rerender(<OrgInvitations {...listProps()} />);
    rerender(<OrgInvitations {...listProps({ copyFailed })} />);
    expect(screen.getByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
  });

  it('a press outside closes the copy-failed popover, a press inside does not', async () => {
    const link = 'https://agentdesk.example/i/a';
    render(<OrgInvitations {...listProps({ copyFailed: { rowId: target.id, link } })} />);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Invitation link' })).getByText(link));
    expect(screen.getByRole('dialog', { name: 'Invitation link' })).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Invitation link' })).not.toBeInTheDocument();
  });

  it('a resize or scroll moves the copy-failed popover with its row', () => {
    let bottom = 300;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const b = this.getAttribute('aria-label') === `Actions for ${target.email}` ? bottom : 0;
      return { top: 0, bottom: b, left: 0, right: 900, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    try {
      render(
        <OrgInvitations {...listProps({ copyFailed: { rowId: target.id, link: 'https://agentdesk.example/i/a' } })} />,
      );
      expect(screen.getByRole('dialog', { name: 'Invitation link' }).style.top).toBe('304px');
      bottom = 200;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByRole('dialog', { name: 'Invitation link' }).style.top).toBe('204px');
      bottom = 100;
      act(() => {
        document.dispatchEvent(new Event('scroll'));
      });
      expect(screen.getByRole('dialog', { name: 'Invitation link' }).style.top).toBe('104px');
    } finally {
      spy.mockRestore();
    }
  });

  it('no copy-failed popover shows when the copy worked', () => {
    render(<OrgInvitations {...listProps()} />);
    expect(screen.queryByText('Invitation link')).not.toBeInTheDocument();
  });

  it.each([
    ['ok', 'Link copied'],
    ['error', 'Could not copy. Select the link and copy it.'],
  ] as const)('a %s notice renders as a status with a Dismiss button', async (tone, title) => {
    const onDismiss = vi.fn();
    render(<OrgInvitations {...listProps({ notice: { tone, title, onDismiss } })} />);
    const status = screen.getByRole('status');
    expect(within(status).getByText(title)).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    await userEvent.click(within(status).getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a notice title with markup renders as text', () => {
    const { container } = render(
      <OrgInvitations {...listProps({ notice: { tone: 'ok', title: '<b>x</b>', onDismiss: vi.fn() } })} />,
    );
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
  });

  it('the dialog layer renders over the page', () => {
    render(<OrgInvitations {...listProps({ children: <p>layer</p> })} />);
    expect(screen.getByText('layer')).toBeInTheDocument();
  });
});

describe('OrgInvitations copy failed', () => {
  it('Copy link in the popover retries the copy for that row', async () => {
    const p = listProps({ copyFailed: { rowId: orgInvitationRows[1].id, link: 'https://agentdesk.example/i/1' } });
    render(<OrgInvitations {...p} />);
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Invitation link' })).getByRole('button', { name: 'Copy link' }),
    );
    expect(p.onCopy).toHaveBeenCalledWith(orgInvitationRows[1].id);
  });
});

describe('CreateOrg', () => {
  const values: CreateOrgValues = {
    name: 'Northwind Analytics',
    slug: 'northwind',
    email: 'maria.chen@northwind.example',
  };
  const createProps = (state: CreateOrgState) => ({
    user,
    state,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    onCopy: vi.fn(),
    onDone: vi.fn(),
  });
  const form = (over: Partial<Extract<CreateOrgState, { kind: 'form' }>> = {}): CreateOrgState => ({
    kind: 'form',
    values,
    errors: {},
    saving: false,
    ...over,
  });
  const failed = (over: Partial<Extract<CreateOrgState, { kind: 'invitationFailed' }>> = {}): CreateOrgState => ({
    kind: 'invitationFailed',
    values,
    errors: {},
    title: 'Internal server error',
    retrying: false,
    ...over,
  });

  it('BR-43: Create organization shows no tabs and passes the account to the menu', async () => {
    render(
      <SignOutProvider onSignOut={vi.fn()}>
        <CreateOrg
          {...createProps(form())}
          org={settingsOrg}
          account={{ name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '/invitations' }}
        />
      </SignOutProvider>,
    );
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    expect(screen.getByText('Kim Hale')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /My invitations/ })).toHaveAttribute('href', '/invitations');
  });

  it('BR-35: shows the h1, the labelled fields with the /o/ prefix described, the hint and Create organization', async () => {
    const p = createProps(form());
    render(<CreateOrg {...p} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create an organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Northwind Analytics');
    expect(screen.getByLabelText('URL')).toHaveValue('northwind');
    expect(screen.getByLabelText('URL')).toHaveAccessibleDescription('/o/');
    expect(screen.getByLabelText('First owner email')).toHaveAccessibleDescription(
      'They get the owner role. Send them the link that appears next.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('reports each edit through onChange with the other values kept', async () => {
    const p = createProps(form());
    render(<CreateOrg {...p} />);
    await userEvent.type(screen.getByLabelText('URL'), 'x');
    expect(p.onChange).toHaveBeenLastCalledWith({ ...values, slug: 'northwindx' });
    await userEvent.type(screen.getByLabelText('Name'), 'y');
    expect(p.onChange).toHaveBeenLastCalledWith({ ...values, name: 'Northwind Analyticsy' });
    await userEvent.type(screen.getByLabelText('First owner email'), 'z');
    expect(p.onChange).toHaveBeenLastCalledWith({ ...values, email: 'maria.chen@northwind.examplez' });
  });

  it('BR-36: field errors render on their own fields and mark them invalid', () => {
    render(
      <CreateOrg
        {...createProps(
          form({
            errors: {
              name: 'Enter a name.',
              slug: 'Use lowercase letters, numbers and dashes, with no dash at the start or end.',
              email: 'Enter a valid email address.',
            },
          }),
        )}
      />,
    );
    const name = screen.getByLabelText('Name');
    expect(name).toBeInvalid();
    expect(name).toHaveAccessibleDescription('Enter a name.');
    const slug = screen.getByLabelText('URL');
    expect(slug).toBeInvalid();
    expect(slug).toHaveAccessibleDescription(
      '/o/ Use lowercase letters, numbers and dashes, with no dash at the start or end.',
    );
    const email = screen.getByLabelText('First owner email');
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription(
      'They get the owner role. Send them the link that appears next. Enter a valid email address.',
    );
  });

  it('BR-36: a taken URL error shows on the URL field only', () => {
    render(<CreateOrg {...createProps(form({ errors: { slug: 'This URL is taken. Try another.' } }))} />);
    expect(screen.getByLabelText('URL')).toBeInvalid();
    expect(screen.getByText('This URL is taken. Try another.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeValid();
    expect(screen.getByLabelText('First owner email')).toBeValid();
  });

  it('saving disables Create, labels it Creating… and makes the fields read-only', async () => {
    const p = createProps(form({ saving: true }));
    render(<CreateOrg {...p} />);
    const button = screen.getByRole('button', { name: 'Creating…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    for (const label of ['Name', 'URL', 'First owner email'])
      expect(screen.getByLabelText(label)).toHaveAttribute('readonly');
    await userEvent.click(button);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('pressing Enter in a field submits the form once', async () => {
    const p = createProps(form());
    render(<CreateOrg {...p} />);
    await userEvent.type(screen.getByLabelText('First owner email'), '{Enter}');
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('while saving, Enter and a submit event do not submit', async () => {
    const p = createProps(form({ saving: true }));
    render(<CreateOrg {...p} />);
    await userEvent.type(screen.getByLabelText('URL'), '{Enter}');
    const formEl = screen.getByLabelText('URL').closest('form');
    if (!formEl) throw new Error('form not rendered');
    fireEvent.submit(formEl);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('a create failure shows the problem title and request ID in an alert above the form, Create stays', () => {
    render(
      <CreateOrg
        {...createProps(form({ formError: { title: 'Internal server error', requestId: 'req_01JD8B2W4N7P' } }))}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Internal server error')).toBeInTheDocument();
    expect(alert).toHaveTextContent('Request ID: req_01JD8B2W4N7P');
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });

  it('BR-39: the invitation-failed state hides Create, makes Name and URL read-only and keeps the email editable', async () => {
    const p = createProps(failed());
    render(<CreateOrg {...p} />);
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('URL')).toHaveAttribute('readonly');
    const email = screen.getByLabelText('First owner email');
    expect(email).not.toHaveAttribute('readonly');
    await userEvent.type(email, 'm');
    expect(p.onChange).toHaveBeenLastCalledWith({ ...values, email: 'maria.chen@northwind.examplem' });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Internal server error')).toBeInTheDocument();
    expect(
      within(alert).getByText('The organization was created. Retry to create the owner invitation.'),
    ).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(p.onRetry).toHaveBeenCalledTimes(1);
  });

  it('BR-39: an email error shows on the email field while retrying is possible', () => {
    render(<CreateOrg {...createProps(failed({ errors: { email: 'Enter a valid email address.' } }))} />);
    expect(screen.getByLabelText('First owner email')).toBeInvalid();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  });

  it('retrying disables the Retry button, labels it Retrying… and makes the email read-only', async () => {
    const p = createProps(failed({ retrying: true }));
    render(<CreateOrg {...p} />);
    const button = screen.getByRole('button', { name: 'Retrying…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('First owner email')).toHaveAttribute('readonly');
    await userEvent.click(button);
    expect(p.onRetry).not.toHaveBeenCalled();
  });

  it('BR-35: the created state focuses its heading and shows the owner link, Copy link and Done', async () => {
    const p = createProps({
      kind: 'created',
      email: 'maria.chen@northwind.example',
      expiresOn: '23 Nov, 14:05',
      link: 'https://agentdesk.example/invitations/7f3c',
    });
    render(<CreateOrg {...p} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Organization created' });
    expect(heading).toHaveFocus();
    expect(
      screen.getByText(
        'Send this link to maria.chen@northwind.example. It works only for that email and expires on 23 Nov, 14:05.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('https://agentdesk.example/invitations/7f3c')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(p.onCopy).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(p.onDone).toHaveBeenCalledTimes(1);
  });

  it('BR-46: forbidden shows "You don\'t have access" and no form', () => {
    render(<CreateOrg {...createProps({ kind: 'forbidden' })} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner of this organization to give you access.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
  });

  it('renders names as text, never as markup', () => {
    render(<CreateOrg {...createProps(form({ values: { ...values, name: '<b>x</b>' } }))} />);
    expect(screen.getByLabelText('Name')).toHaveValue('<b>x</b>');
    expect(document.querySelector('b')).toBeNull();
  });
});

/** OrgInvitations renders the page body only: the settings layout draws the bar. */
describe('OrgInvitations inside the settings layout', () => {
  it('it renders no top bar of its own and keeps its table and the revoke dialog', () => {
    const rest = listProps({
      revokeConfirm: { email: 'x@example.com', onConfirm: vi.fn(), onCancel: vi.fn() },
    });
    render(<OrgInvitations {...rest} />);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Revoke invitation for x@example.com?' })).toBeInTheDocument();
  });

  it('the forbidden state renders no top bar either', () => {
    const rest = listProps({ state: { kind: 'forbidden' } });
    render(<OrgInvitations {...rest} />);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
  });

  const tabNames = () =>
    within(screen.getByRole('navigation', { name: 'Organization settings' }))
      .getAllByRole('link')
      .map((a) => a.textContent);

  it('the frame for an owner shows the app bar with Settings active and the full side menu', () => {
    render(
      <OrgSettingsFrame role="owner" active="invitations">
        <p>Body</p>
      </OrgSettingsFrame>,
    );
    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(main.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(tabNames()).toEqual(['General', 'Members', 'Invitations', 'Audit log']);
    const side = within(screen.getByRole('navigation', { name: 'Organization settings' }));
    expect(side.getByRole('link', { name: 'Invitations' })).toHaveAttribute('aria-current', 'page');
  });

  it('the frame for a project admin lists only Invitations', () => {
    render(
      <OrgSettingsFrame role="projectAdmin" active="invitations">
        <p>Body</p>
      </OrgSettingsFrame>,
    );
    expect(tabNames()).toEqual(['Invitations']);
  });

  it('the frame for a member has no Settings tab and, without a side menu, no settings navigation', () => {
    render(
      <OrgSettingsFrame role="member" active={null} sideMenu={false}>
        <p>Body</p>
      </OrgSettingsFrame>,
    );
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Organization settings' })).not.toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  const noTabActive = () => {
    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(main.getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    expect(main.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  };

  it('BR-43: My invitations shows the org bar with no tab active', () => {
    render(<MyInvitations {...props({ kind: 'list', cards: invitationCards, pending: null })} org={settingsOrg} />);
    noTabActive();
  });

  it('BR-43: the invitation page shows the org bar with no tab active and passes the account to the menu', async () => {
    render(
      <SignOutProvider onSignOut={vi.fn()}>
        <InvitationAccept
          {...accept({ kind: 'revoked' })}
          org={settingsOrg}
          account={{ name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '/invitations' }}
        />
      </SignOutProvider>,
    );
    noTabActive();
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    expect(screen.getByText('Kim Hale')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /My invitations/ })).toHaveAttribute('href', '/invitations');
  });

  it('MyInvitations passes the account to the account menu', async () => {
    render(
      <SignOutProvider onSignOut={vi.fn()}>
        <MyInvitations
          {...props({ kind: 'list', cards: invitationCards, pending: null })}
          account={{ name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '/invitations' }}
        />
      </SignOutProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Account menu/ }));
    expect(screen.getByText('Kim Hale')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /My invitations/ })).toHaveAttribute('href', '/invitations');
  });
});
