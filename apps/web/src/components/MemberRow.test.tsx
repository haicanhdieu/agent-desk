import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MemberRowView } from '@/mocks/types';
import { MemberRow, memberColumns } from './MemberRow';

const base: MemberRowView = {
  userId: 'u1',
  name: 'Cleo Martin',
  handle: 'cleo',
  you: false,
  role: { key: 'member', name: 'Member' },
  projectRoles: '—',
  canChangeRole: true,
  canRemove: true,
};

function renderRow(over: Partial<MemberRowView> = {}, props: Partial<Parameters<typeof MemberRow>[0]> = {}) {
  const row = { ...base, ...over };
  const handlers = { onChangeRole: vi.fn(), onRemove: vi.fn() };
  const view = render(
    <table>
      <tbody>
        <MemberRow row={row} {...handlers} {...props} />
      </tbody>
    </table>,
  );
  return { row, ...handlers, ...view };
}

const menuButton = (name: string) => screen.getByRole('button', { name: `Actions for ${name}` });

describe('MemberRow', () => {
  it('shows the name with the handle in muted mono', () => {
    renderRow();
    expect(screen.getByText('Cleo Martin')).toHaveAttribute('title', 'Cleo Martin');
    expect(screen.getByText('cleo')).toHaveClass('handle');
  });

  it.each([
    ['empty', ''],
    ['equal to the handle', 'cleo'],
  ])('shows the handle once and no empty title when the name is %s', (_label, name) => {
    const { container } = renderRow({ name });
    expect(screen.getAllByText('cleo')).toHaveLength(1);
    expect(container.querySelector('[title=""]')).toBeNull();
    expect(container.querySelector('[title="cleo"]')).toBeNull();
  });

  it('tags the own row with You and no other row', () => {
    const { unmount } = renderRow({ you: true });
    expect(screen.getByText('You')).toBeInTheDocument();
    unmount();
    renderRow();
    expect(screen.queryByText('You')).toBeNull();
  });

  it('shows the role name, or No role', () => {
    const { unmount } = renderRow({ role: { key: 'admin', name: 'Admin' } });
    expect(screen.getByText('Admin')).toBeInTheDocument();
    unmount();
    renderRow({ role: null });
    expect(screen.getByText('No role')).toBeInTheDocument();
  });

  it('shows project roles with a title, or a dash', () => {
    const { unmount } = renderRow({ projectRoles: 'Alpha (Admin), Beta (Member)' });
    expect(screen.getByText('Alpha (Admin), Beta (Member)')).toHaveAttribute('title', 'Alpha (Admin), Beta (Member)');
    unmount();
    renderRow();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('lists Change role and Remove from organization and calls the handlers with the row', async () => {
    const { row, onChangeRole, onRemove } = renderRow();
    await userEvent.click(menuButton(row.name));
    const menu = screen.getByRole('dialog', { name: `Actions for ${row.name}` });
    await userEvent.click(within(menu).getByRole('button', { name: 'Change role' }));
    expect(onChangeRole).toHaveBeenCalledWith(row);
    await userEvent.click(menuButton(row.name));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from organization' }));
    expect(onRemove).toHaveBeenCalledWith(row);
  });

  it('offers no Remove on the own row (BR-9)', async () => {
    renderRow({ you: true, canRemove: false });
    await userEvent.click(menuButton('Cleo Martin'));
    expect(screen.getByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from organization' })).toBeNull();
  });

  it('has no menu on the own row when neither action is offered (no role change on yourself)', () => {
    renderRow({ you: true, canChangeRole: false, canRemove: false });
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('has no menu button when no action is allowed (BR-4)', () => {
    renderRow({ canChangeRole: false, canRemove: false });
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('disables the menu while busy', async () => {
    renderRow({}, { busy: true });
    const button = menuButton('Cleo Martin');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders HTML-like names as text', () => {
    const name = '<img src=x onerror=alert(1)>';
    const { container } = renderRow({ name });
    expect(screen.getByText(name)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('declares the four columns with Actions for screen readers only', () => {
    expect(memberColumns).toHaveLength(4);
    render(
      <table>
        <thead>
          <tr>
            {memberColumns.map((c) => (
              <th key={c.key}>{c.header}</th>
            ))}
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Project roles')).toBeInTheDocument();
    expect(screen.getByText('Actions')).toHaveClass('sr-only');
  });
});
