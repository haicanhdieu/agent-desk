import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ids } from '@/mocks/dto/ids';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

const cards = () => screen.getAllByRole('listitem');
const firstCard = (): HTMLElement => {
  const [card] = cards();
  if (!card) throw new Error('no invitation card');
  return card;
};
const firstPending = () => {
  const row = mockDb.state.invitations.find((i) => i.status === 'pending');
  if (!row) throw new Error('no pending invitation');
  return row;
};
const meId = () => {
  const user = mockDb.state.users[0];
  if (!user) throw new Error('no user');
  return user.id;
};
const buttonIn = (card: HTMLElement, name: string) => within(card).getByRole('button', { name });

// The mock invitations expire on a fixed date; pin the clock before it so the cards stay pending.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('welcome page with invitations', () => {
  it('BR-2 / lands on /invitations with one card per pending invitation, each with Accept and Decline', async () => {
    const { router } = await renderRoute('/', { scenario: () => scenarios.onboarding('noOrgInvited') });
    expect(await screen.findByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/invitations');
    const pending = mockDb.state.invitations.filter((i) => i.status === 'pending');
    expect(pending.length).toBeGreaterThan(1);
    expect(cards()).toHaveLength(pending.length);
    for (const card of cards()) {
      expect(within(card).getByRole('heading', { name: 'Acme Robotics invited you as Member' })).toBeInTheDocument();
      expect(buttonIn(card, 'Accept')).toBeEnabled();
      expect(buttonIn(card, 'Decline')).toBeEnabled();
    }
    expect(screen.getAllByText('Whole organization')).toHaveLength(3);
    expect(screen.getByText('invoicer-api, invoicer-web')).toBeInTheDocument();
  });

  it('TC-4.1 lists only the pending invitation, not the expired and revoked ones', async () => {
    await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgInvitedStates') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    expect(cards()).toHaveLength(1);
  });

  it('TC-52.3 shows "Invited by <name>, expires <date>" and drops "Invited by" when the inviter is gone', async () => {
    await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgInvited') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    expect(screen.getAllByText(/^Invited by Ada Lovelace, expires 23 Nov, \d\d:\d\d$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Expires 23 Nov, \d\d:\d\d$/)).toBeInTheDocument();
  });

  it('shows the error state with Retry when the list fails', async () => {
    await renderRoute('/invitations', {
      scenario: () => {
        scenarios.onboarding('noOrgInvited');
        scenarios.serverError('me.listInvitations');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('still lists the pending invitations when the access check fails', async () => {
    await renderRoute('/invitations', {
      scenario: () => {
        scenarios.onboarding('noOrgInvited');
        scenarios.serverError('me.access');
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Invitations' })).toBeInTheDocument();
    expect(cards().length).toBeGreaterThan(0);
    expect(buttonIn(firstCard(), 'Accept')).toBeEnabled();
  });
});

describe('welcome page without invitations', () => {
  it('BR-37 shows the heading, the body with the session email and Sign out, and no Create organization', async () => {
    await renderRoute('/', { scenario: () => scenarios.onboarding('noOrgUninvited') });
    expect(await screen.findByRole('heading', { name: "You're not a member of any organization" })).toBeInTheDocument();
    expect(
      screen.getByText('No invitations for uninvited@x.dev. Ask an owner or admin to invite you.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('Create organization')).toBeNull();
  });

  it('TC-37.2 Sign out signs out and goes to /sign-in', async () => {
    const { router, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgUninvited'),
    });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.location.href).toBe('/sign-in');
    expect(mockDb.auth.signedIn).toBe(false);
  });

  it('BR-34 a platform admin sees Create organization and a switcher reading "No organization"', async () => {
    await renderRoute('/', { scenario: () => scenarios.onboarding('platformAdminNoOrg') });
    expect(await screen.findByRole('heading', { name: "You're not a member of any organization" })).toBeInTheDocument();
    expect(screen.getByText('Create an organization and invite its first owner.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create organization' })).toHaveAttribute('href', '/platform/orgs/new');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch scope, currently no organization' })).toHaveTextContent(
      'No organization',
    );
  });

  it('shows the error state when the access check fails, instead of hiding Create organization', async () => {
    await renderRoute('/invitations', {
      scenario: () => {
        scenarios.onboarding('platformAdminNoOrg');
        scenarios.serverError('me.access');
      },
    });
    expect(await screen.findByText('Internal server error')).toBeInTheDocument();
    expect(screen.queryByText('Create organization')).toBeNull();
  });
});

describe('welcome page for a member without invitations', () => {
  it('BR-57: a member with no pending invitation is not told they are no member', async () => {
    await renderRoute('/invitations', { scenario: () => scenarios.onboarding('memberNoInvites') });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pending invitations' })).toBeInTheDocument();
    const email = mockDb.state.users[0]?.email ?? '';
    expect(screen.getByText(`No invitations for ${email}.`)).toBeInTheDocument();
    expect(screen.queryByText("You're not a member of any organization")).toBeNull();
    const main = within(screen.getByRole('main'));
    expect(main.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(main.queryByRole('button', { name: 'Create organization' })).toBeNull();
    expect(main.queryByRole('link', { name: 'Create organization' })).toBeNull();
  });

  it('BR-57: a platform admin who is a member sees the same member text, with no Create organization', async () => {
    await renderRoute('/invitations', {
      scenario: () => {
        scenarios.onboarding('memberNoInvites');
        const me = mockDb.state.users[0];
        if (me) me.platformAdmin = true;
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'No pending invitations' })).toBeInTheDocument();
    expect(screen.queryByText('Create an organization and invite its first owner.')).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('link', { name: 'Create organization' })).toBeNull();
  });
});

describe('accept and decline', () => {
  it('Accept joins the org, refreshes the org list and lands on its projects page', async () => {
    const { router, queryClient, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgInvited'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const id = firstPending().id;
    await user.click(buttonIn(firstCard(), 'Accept'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme-robotics/projects'));
    expect(mockDb.requests('POST', `/api/me/invitations/${id}/accept`)).toBe(1);
    expect(queryClient.getQueryData(['session', 'orgs'])).toEqual([expect.objectContaining({ slug: 'acme-robotics' })]);
  });

  it('BR-41 after accepting one, the others stay listed as pending', async () => {
    const { router, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgInvited'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const before = cards().length;
    await user.click(buttonIn(firstCard(), 'Accept'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/o/acme-robotics/projects'));
    await router.navigate({ to: '/invitations' });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    await waitFor(() => expect(cards()).toHaveLength(before - 1));
    expect(screen.getAllByText('Whole organization')).toHaveLength(2);
  });

  it('Decline asks for confirmation; Cancel keeps the card and sends nothing', async () => {
    const { user } = await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgInvited') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const firstId = firstPending().id;
    const before = cards().length;
    await user.click(buttonIn(firstCard(), 'Decline'));
    const dialog = await screen.findByRole('dialog', { name: 'Decline invitation to Acme Robotics?' });
    expect(within(dialog).getByText('You will need a new invitation to join later.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(cards()).toHaveLength(before);
    expect(mockDb.requests('POST', `/api/me/invitations/${firstId}/decline`)).toBe(0);
  });

  it('BR-22 confirming Decline removes the card and the invitation is declined', async () => {
    const { user } = await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgInvited') });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const before = cards().length;
    const firstId = firstPending().id;
    await user.click(buttonIn(firstCard(), 'Decline'));
    const dialog = await screen.findByRole('dialog', { name: 'Decline invitation to Acme Robotics?' });
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(cards()).toHaveLength(before - 1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockDb.state.invitations.find((i) => i.id === firstId)?.status).toBe('declined');
  });

  it('BR-45 declining the last invitation leaves the welcome page with no org', async () => {
    const { router, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgInvitedStates'),
    });
    await user.click(buttonIn(await screen.findByRole('listitem'), 'Decline'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(await screen.findByRole('heading', { name: "You're not a member of any organization" })).toBeInTheDocument();
    expect(
      screen.getByText('No invitations for invitee@x.dev. Ask an owner or admin to invite you.'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/invitations');
  });

  it('BR-23 accepting an invitation that was revoked meanwhile shows the error, refreshes the list and joins nothing', async () => {
    const { router, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgInvited'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const before = cards().length;
    const row = firstPending();
    row.status = 'revoked';
    await user.click(buttonIn(firstCard(), 'Accept'));
    await waitFor(() => expect(cards()).toHaveLength(before - 1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/invitations');
    expect(mockDb.state.memberships.filter((m) => m.userId === meId())).toHaveLength(0);
  });

  it('declining an invitation that was revoked meanwhile closes the dialog, shows the error and refreshes the list', async () => {
    const { router, user } = await renderRoute('/invitations', {
      scenario: () => scenarios.onboarding('noOrgInvited'),
    });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const before = cards().length;
    firstPending().status = 'revoked';
    await user.click(buttonIn(firstCard(), 'Decline'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(cards()).toHaveLength(before - 1));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(router.state.location.pathname).toBe('/invitations');
  });
});

const ownerWithInvitations = () => {
  scenarios.onboarding('noOrgInvited');
  const me = mockDb.state.users[0];
  if (!me) throw new Error('no user');
  mockDb.state.memberships = [{ userId: me.id, orgId: ids.org.alice, roleKey: 'owner' }];
  mockDb.state.auth = { signedIn: true, activeOrganizationId: ids.org.alice };
};

const mainNav = () => screen.queryByRole('navigation', { name: 'Organization sections' });

describe('welcome page under the app bar', () => {
  it('BR-43 / BR-13 an owner sees the org bar with no tab active and Settings in the org menu', async () => {
    const { user } = await renderRoute('/invitations', { scenario: ownerWithInvitations });
    await screen.findByRole('heading', { level: 1, name: 'Invitations' });
    const nav = await screen.findByRole('navigation', { name: 'Organization sections' });
    expect(within(nav).getByRole('link', { name: 'Projects' })).not.toHaveAttribute('aria-current');
    expect(await within(nav).findByRole('link', { name: 'Org settings' })).not.toHaveAttribute('aria-current');
    await user.click(screen.getByRole('button', { name: /^Switch scope/ }));
    const menu = await screen.findByRole('dialog', { name: 'Scope' });
    expect(within(menu).getByRole('link', { name: 'Org settings' })).toHaveAttribute('href', '/o/alice/settings');
  });

  it('BR-43 a person with no org sees "No organization", the bell and no tabs', async () => {
    await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgUninvited') });
    await screen.findByRole('heading', { level: 1, name: "You're not a member of any organization" });
    expect(screen.getByText('No organization')).toBeInTheDocument();
    expect(mainNav()).toBeNull();
    expect(screen.getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });
});
