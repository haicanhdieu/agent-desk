import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlatformOrgHeader, type PlatformOrgHeaderProps } from './PlatformOrgHeader';

function setup(over: Partial<PlatformOrgHeaderProps> = {}) {
  const handlers = { onSuspend: vi.fn(), onReactivate: vi.fn() };
  render(
    <PlatformOrgHeader
      name="Acme"
      slug="acme"
      status="active"
      auditHref="/platform/audit?org=1"
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'More actions' }));

describe('PlatformOrgHeader', () => {
  it('shows the name as a focusable h1, the slug path and the status', () => {
    setup();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Acme' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('/o/acme')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows Edit organization as the only visible action button, next to More actions', () => {
    setup({ onEdit: vi.fn(), openHref: '/o/acme/projects' });
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Edit organization',
      'More actions',
    ]);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Suspend organization' })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has an icon-only More actions trigger that reflects the menu state', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('title', 'More actions');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers Suspend for an active org, then the audit log', async () => {
    const h = setup();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Reactivate organization' })).toBeNull();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Suspend organization',
      'View audit log',
    ]);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Suspend organization' }));
    expect(h.onSuspend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('styles Suspend organization as a destructive menu item, not a danger button', async () => {
    setup();
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'Suspend organization' });
    expect(item).toHaveClass('danger');
    expect(item).not.toHaveClass('btn');
  });

  it('offers Reactivate for a suspended org, as a normal item', async () => {
    const h = setup({ status: 'suspended' });
    expect(screen.getByText('Suspended')).toBeInTheDocument();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Suspend organization' })).toBeNull();
    const item = screen.getByRole('menuitem', { name: 'Reactivate organization' });
    expect(item).not.toHaveClass('danger');
    await userEvent.click(item);
    expect(h.onReactivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the audit log href and closes the menu when it is chosen', async () => {
    setup();
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'View audit log' });
    expect(item).toHaveAttribute('href', '/platform/audit?org=1');
    await userEvent.click(item);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has no Edit button without onEdit', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Edit organization' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
  });

  it('calls onEdit from the Edit organization button', async () => {
    const onEdit = vi.fn();
    setup({ onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit organization' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it.each(['active', 'suspended'] as const)(
    'orders the menu: status action, separator, audit, open (%s)',
    async (status) => {
      setup({ status, openHref: '/o/acme/projects' });
      await openMenu();
      const statusLabel = status === 'active' ? 'Suspend organization' : 'Reactivate organization';
      expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
        statusLabel,
        'View audit log',
        'Open organization',
      ]);
      const roles = Array.from(screen.getByRole('menu').querySelectorAll('[role="menuitem"],[role="separator"]')).map(
        (el) => el.getAttribute('role'),
      );
      expect(roles).toEqual(['menuitem', 'separator', 'menuitem', 'menuitem']);
    },
  );

  it('shows "Open organization" only with openHref, keeping its href', async () => {
    const { unmount } = render(
      <PlatformOrgHeader
        name="Acme"
        slug="acme"
        status="active"
        auditHref="/platform/audit?org=1"
        openHref="/o/acme/projects"
        onSuspend={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Open organization' })).toHaveAttribute('href', '/o/acme/projects');
    unmount();
    setup();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Open organization' })).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Suspend organization' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on a press outside the menu', async () => {
    setup();
    await openMenu();
    await userEvent.click(screen.getByRole('heading', { level: 1, name: 'Acme' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens with Enter and Space on the trigger', async () => {
    setup();
    screen.getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard(' ');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('opens with ArrowDown on the trigger', async () => {
    setup();
    screen.getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('moves between items with the arrow keys, Home and End, and activates with Enter', async () => {
    const h = setup({ openHref: '/o/acme/projects' });
    await openMenu();
    const [suspend, audit, open] = screen.getAllByRole('menuitem');
    expect(suspend).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(audit).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(open).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(suspend).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(open).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(suspend).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(open).toHaveFocus();
    await userEvent.keyboard('{Home}{Enter}');
    expect(h.onSuspend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
