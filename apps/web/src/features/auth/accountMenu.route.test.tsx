import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/renderRoute';

describe('account menu fed by the session', () => {
  it('shows the signed-in name with the full email under it, and no My invitations item', async () => {
    const { user } = await renderRoute('/o/alice/projects');
    await user.click(await screen.findByRole('button', { name: /^Account menu for / }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    expect(within(menu).getByText('Alice')).toBeInTheDocument();
    expect(within(menu).getByText('alice@example.com')).toHaveClass('mono');
    expect(within(menu).queryByRole('menuitem', { name: /My invitations/ })).toBeNull();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Logout']);
  });
});
