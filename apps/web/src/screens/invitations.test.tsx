import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invitationCards, invitationDetails, orgSwitchFixtures, user } from '@/mocks';
import { InvitationAccept, type InvitationAcceptState } from './InvitationAccept';
import { MyInvitations, type MyInvitationsState } from './MyInvitations';

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
