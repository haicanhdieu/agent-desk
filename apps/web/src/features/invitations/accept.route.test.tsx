import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { myInvitationFixtures as fx } from '@/mocks/dto/invitations';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { server } from '@/mocks/msw/node';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const pendingId = fx.pending.id;
const open = (id: string, scenario = 'noOrgInvited' as const) =>
  renderRoute(`/invitations/${id}`, { scenario: () => scenarios.onboarding(scenario) });
const row = (id: string) => {
  const found = mockDb.state.invitations.find((i) => i.id === id);
  if (!found) throw new Error(`no invitation ${id}`);
  return found;
};
const noButtons = () => {
  expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
};

// The mock invitations expire on a fixed date; pin the clock before it so the pending ones stay pending.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('invitation link: the matching person', () => {
  it('BR-25 a pending invitation shows the org, role, access, inviter and expiry, then Accept and Decline', async () => {
    await open(pendingId);
    expect(await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeInTheDocument();
    expect(screen.getByText('Role').nextElementSibling).toHaveTextContent('Member');
    expect(screen.getByText('Access').nextElementSibling).toHaveTextContent('Whole organization');
    expect(screen.getByText('Invited by').nextElementSibling).toHaveTextContent('Ada Lovelace');
    const expires = screen.getByText('23 Nov, 14:05');
    expect(expires).toHaveAttribute('title', '23 Nov 2026, 14:05');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('Accept')).toBeGreaterThanOrEqual(0);
    expect(buttons.indexOf('Accept')).toBeLessThan(buttons.indexOf('Decline'));
  });

  it('BR-25 the inviter name is shown as the API gave it', async () => {
    await open(fx.pendingInviterHandle.id);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    expect(screen.getByText('Invited by').nextElementSibling).toHaveTextContent('ada');
  });

  it('BR-25 project scope lists the project names', async () => {
    await open(fx.pendingProjects.id);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    expect(screen.getByText('Access').nextElementSibling).toHaveTextContent('invoicer-api, invoicer-web');
  });

  it('BR-26 an accepted invitation reads "You already joined Acme Robotics" with a link, no buttons', async () => {
    await open(fx.accepted.id);
    expect(await screen.findByRole('heading', { name: 'You already joined Acme Robotics' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Acme Robotics' })).toHaveAttribute(
      'href',
      '/o/acme-robotics/projects',
    );
    noButtons();
  });

  it('BR-26 a declined invitation reads "You declined this invitation" with Go to invitations, no buttons', async () => {
    await open(fx.declined.id);
    expect(await screen.findByRole('heading', { name: 'You declined this invitation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to invitations' })).toHaveAttribute('href', '/invitations');
    noButtons();
  });

  it('BR-26 / TC-4.2 a revoked invitation reads "This invitation was revoked", no buttons', async () => {
    await open(fx.revoked.id);
    expect(await screen.findByRole('heading', { name: 'This invitation was revoked' })).toBeInTheDocument();
    noButtons();
  });

  it('BR-26 / BR-48 / TC-4.3 an expired invitation reads "This invitation has expired. Ask Ada Lovelace to resend it."', async () => {
    await open(fx.expired.id);
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeInTheDocument();
    expect(screen.getByText('Ask Ada Lovelace to resend it.')).toBeInTheDocument();
    noButtons();
  });

  it('BR-48 an expired invitation with a deleted inviter names the owners and admins instead', async () => {
    const id = 'b4000000-0000-4000-8000-000000000009';
    await open(id);
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner or admin of Acme Robotics to resend it.')).toBeInTheDocument();
    noButtons();
  });

  it('BR-48 a pending invitation whose time has passed shows as expired', async () => {
    vi.setSystemTime(new Date('2026-11-24T00:00:00.000Z'));
    await open(pendingId);
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeInTheDocument();
    noButtons();
  });
});

describe('invitation link: not available', () => {
  it('BR-5 / TC-5.3 an unknown id shows "not available" with the session email and Sign out, and no org, role or email', async () => {
    await open('b9999999-0000-4000-8000-000000000001');
    expect(await screen.findByRole('heading', { name: 'This invitation is not available' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as invitee@x.dev')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    noButtons();
  });

  it('BR-5 / TC-5.1 an invitation for another email looks the same and leaks nothing', async () => {
    scenarios.onboarding('noOrgInvited');
    const other = { ...row(pendingId), id: 'b8000000-0000-4000-8000-000000000001', email: 'someone@x.dev' };
    mockDb.state.invitations.push(other);
    await renderRoute(`/invitations/${other.id}`);
    expect(await screen.findByRole('heading', { name: 'This invitation is not available' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Check that you signed in with the email it was sent to, or ask the person who invited you for a new link.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Signed in as invitee@x.dev')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    noButtons();
    expect(document.body.textContent).not.toContain('Acme Robotics');
    expect(document.body.textContent).not.toContain('Member');
    expect(document.body.textContent).not.toContain('someone@x.dev');
    // Nothing was joined: no accept request, the invitation is still pending and the user has no new seat.
    expect(mockDb.requests('POST', `/api/me/invitations/${other.id}/accept`)).toBe(0);
    expect(row(other.id).status).toBe('pending');
    expect(mockDb.state.memberships.filter((m) => m.userId === mockDb.state.users[0]?.id)).toHaveLength(0);
  });

  it('BR-5 Sign out signs out and goes to sign-in, back to the link', async () => {
    const id = 'b9999999-0000-4000-8000-000000000001';
    const { router, user } = await open(id);
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.href).toBe(`/sign-in?redirect=${encodeURIComponent(`/invitations/${id}`)}`);
    expect(mockDb.auth.signedIn).toBe(false);
  });

  it('a malformed id shows not available without calling the API', async () => {
    await open('not-a-uuid');
    expect(await screen.findByRole('heading', { name: 'This invitation is not available' })).toBeInTheDocument();
    expect(screen.getByText('Signed in as invitee@x.dev')).toBeInTheDocument();
    expect(mockDb.requests('GET', '/api/me/invitations/not-a-uuid')).toBe(0);
  });
});

describe('invitation link: failures', () => {
  it('shows the error state with Retry when the load fails, and Retry loads the invitation', async () => {
    let fail = true;
    server.use(
      http.get('/api/me/invitations/:invitationId', () => {
        if (fail) return HttpResponse.error();
        return undefined;
      }),
    );
    const { user } = await open(pendingId);
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    noButtons();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeInTheDocument();
  });
});

describe('invitation link: answering', () => {
  it('BR-21 Accept joins the org and lands on its projects page', async () => {
    const { router, user } = await open(pendingId);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme-robotics/projects'));
    expect(mockDb.requests('POST', `/api/me/invitations/${pendingId}/accept`)).toBe(1);
  });

  it('BR-23 / BR-42 Accept answered 409 refetches and shows "You already joined Acme Robotics", nothing navigates', async () => {
    const { router, user } = await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    // Another tab accepted first.
    row(pendingId).status = 'accepted';
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'You already joined Acme Robotics' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Acme Robotics' })).toBeInTheDocument();
    noButtons();
    expect(router.state.location.pathname).toBe(`/invitations/${pendingId}`);
    expect(mockDb.state.memberships.filter((m) => m.userId === mockDb.state.users[0]?.id)).toHaveLength(0);
  });

  it('BR-23 Accept answered 409 on a revoked invitation shows "This invitation was revoked"', async () => {
    const { user } = await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    row(pendingId).status = 'revoked';
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'This invitation was revoked' })).toBeInTheDocument();
    noButtons();
  });

  it('Decline asks for confirmation; Cancel keeps the pending state and sends nothing', async () => {
    const { user } = await open(pendingId);
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Decline invitation to Acme Robotics?' });
    expect(within(dialog).getByText('You will need a new invitation to join later.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'Join Acme Robotics' })).toBeInTheDocument();
    expect(mockDb.requests('POST', `/api/me/invitations/${pendingId}/decline`)).toBe(0);
  });

  it('confirming Decline shows "You declined this invitation" with Go to invitations', async () => {
    const { user } = await open(pendingId);
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('heading', { name: 'You declined this invitation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to invitations' })).toHaveAttribute('href', '/invitations');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(row(pendingId).status).toBe('declined');
  });

  it('the Decline dialog ignores Escape and Cancel while the request is in flight', async () => {
    const { user } = await open(pendingId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('/api/me/invitations/:invitationId/decline', async () => {
        await gate;
        row(pendingId).status = 'declined';
        return HttpResponse.json(null);
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await within(dialog).findByRole('button', { name: 'Declining…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('heading', { name: 'You declined this invitation' })).toBeInTheDocument();
  });

  it('BR-23 Accept answered 409 on an invitation that expired meanwhile shows the expired copy, no buttons', async () => {
    const { user } = await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    row(pendingId).status = 'expired';
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'This invitation has expired' })).toBeInTheDocument();
    expect(screen.getByText('Ask Ada Lovelace to resend it.')).toBeInTheDocument();
    noButtons();
  });

  it('BR-23 Accept answered 409 on an invitation declined meanwhile shows "You declined this invitation", no buttons', async () => {
    const { user } = await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    row(pendingId).status = 'declined';
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'You declined this invitation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to invitations' })).toHaveAttribute('href', '/invitations');
    noButtons();
  });

  it('BR-23 Accept answered 409 never flashes the error state before the refetched state shows', async () => {
    const { user } = await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    let flashed = false;
    const watch = new MutationObserver(() => {
      if (document.body.textContent.includes('Internal server error')) flashed = true;
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    row(pendingId).status = 'revoked';
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('heading', { name: 'This invitation was revoked' })).toBeInTheDocument();
    watch.disconnect();
    expect(flashed).toBe(false);
  });

  it('BR-23 / BR-42 Decline answered 409 on a revoked invitation shows "This invitation was revoked" and closes the dialog', async () => {
    const { user } = await open(pendingId);
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog');
    row(pendingId).status = 'revoked';
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('heading', { name: 'This invitation was revoked' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    noButtons();
  });

  it('a 409 that the refetch does not explain falls to the error state with Retry', async () => {
    scenarios.onboarding('noOrgInvited');
    scenarios.problem('me.acceptInvitation', { status: 409, title: 'Conflict', type: 'conflict' });
    const { user } = await renderRoute(`/invitations/${pendingId}`);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    noButtons();
  });

  it('a failed Accept other than 409 keeps the page and shows the error as a toast', async () => {
    scenarios.onboarding('noOrgInvited');
    scenarios.serverError('me.acceptInvitation');
    const { router, user } = await renderRoute(`/invitations/${pendingId}`);
    await user.click(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(router.state.location.pathname).toBe(`/invitations/${pendingId}`);
  });
});

describe('invitation link under the app bar', () => {
  const asOwnerOfAlice = () => {
    scenarios.onboarding('noOrgInvited');
    const me = mockDb.state.users[0];
    if (!me) throw new Error('no user');
    mockDb.state.memberships = [{ userId: me.id, orgId: ids.org.alice, roleKey: 'owner' }];
    mockDb.state.auth = { signedIn: true, activeOrganizationId: ids.org.alice };
  };

  it('BR-43 / BR-13 an owner sees the org bar with no tab active and Settings in the org menu', async () => {
    const { user } = await renderRoute(`/invitations/${pendingId}`, { scenario: asOwnerOfAlice });
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    const nav = await screen.findByRole('navigation', { name: 'Organization sections' });
    expect(within(nav).getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/o/alice/settings');
  });

  it('BR-43 a person with no org sees "No organization" and no tabs', async () => {
    await open(pendingId);
    await screen.findByRole('heading', { level: 1, name: 'Join Acme Robotics' });
    expect(screen.getByText('No organization')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Organization sections' })).toBeNull();
  });
});
