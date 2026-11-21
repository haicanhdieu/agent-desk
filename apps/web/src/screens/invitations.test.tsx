import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invitationCards, user } from '@/mocks';
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
