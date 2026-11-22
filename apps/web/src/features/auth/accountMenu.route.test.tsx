import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '@/mocks/msw/db';
import { scenarios } from '@/mocks/msw/scenarios';
import { renderRoute } from '@/test/renderRoute';

// The mock invitations expire on a fixed date; pin the clock before it so they stay pending.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('account menu fed by the session', () => {
  it('shows the signed-in name and handle and the count of pending invitations, linking to /invitations', async () => {
    const { user } = await renderRoute('/invitations', { scenario: () => scenarios.onboarding('noOrgInvited') });
    const pending = mockDb.state.invitations.filter((i) => i.status === 'pending').length;
    expect(pending).toBeGreaterThan(0);

    await user.click(await screen.findByRole('button', { name: 'Account menu for invitee' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('Invitee')).toBeInTheDocument();
    expect(within(menu).getByText('invitee')).toHaveClass('mono');
    const link = await within(menu).findByRole('menuitem', { name: /My invitations/ });
    expect(link).toHaveAttribute('href', '/invitations');
    expect(await within(link).findByText(`${pending} pending`)).toBeInTheDocument();
  });

  it('shows no pending count for a user with none', async () => {
    const { user } = await renderRoute('/o/alice/projects');
    await user.click(await screen.findByRole('button', { name: /^Account menu for / }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('Alice')).toBeInTheDocument();
    const link = within(menu).getByRole('menuitem', { name: /My invitations/ });
    expect(within(link).queryByText(/pending/)).toBeNull();
  });
});
