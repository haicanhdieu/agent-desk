import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformMemberRowView } from '@/mocks/platform/tabs';
import { PlatformMemberRow, platformMemberColumns } from './PlatformMemberRow';

const base: PlatformMemberRowView = {
  userId: 'u1',
  name: 'Cleo Martin',
  handle: 'cleo',
  email: 'cleo@example.com',
  assignments: [
    { assignmentId: 'a1', label: 'Owner (organization)' },
    { assignmentId: 'a2', label: 'Member (Alpha)' },
  ],
};

function renderRow(over: Partial<PlatformMemberRowView> = {}, props: { busy?: boolean } = {}) {
  const row = { ...base, ...over };
  const handlers = { onAdd: vi.fn(), onRemove: vi.fn() };
  const view = render(
    <table>
      <tbody>
        <PlatformMemberRow row={row} {...handlers} {...props} />
      </tbody>
    </table>,
  );
  return { row, ...handlers, ...view };
}

describe('PlatformMemberRow', () => {
  it('names the columns Name, Email, Roles and Actions', () => {
    expect(platformMemberColumns.map((c) => c.key)).toEqual(['name', 'email', 'roles', 'actions']);
    expect(platformMemberColumns.slice(0, 3).map((c) => c.header)).toEqual(['Name', 'Email', 'Roles']);
  });

  it('shows the name with the handle under it', () => {
    renderRow();
    expect(screen.getByText('Cleo Martin')).toBeInTheDocument();
    expect(screen.getByText('cleo')).toHaveClass('handle');
    expect(screen.getByText('cleo@example.com')).toBeInTheDocument();
  });

  it('shows the handle alone when there is no name', () => {
    renderRow({ name: null });
    expect(screen.getByText('cleo')).toBeInTheDocument();
    expect(screen.queryByText('Cleo Martin')).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for cleo' })).toBeInTheDocument();
  });

  it('joins the roles with ", " and shows a dash when there are none', () => {
    const { unmount } = renderRow();
    expect(screen.getByText('Owner (organization), Member (Alpha)')).toBeInTheDocument();
    unmount();
    renderRow({ assignments: [] });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('offers Add assignment first, then one Remove per assignment', async () => {
    const user = userEvent.setup();
    const { row, onAdd, onRemove } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names.slice(1)).toEqual(['Add assignment', 'Remove Owner (organization)', 'Remove Member (Alpha)']);
    await user.click(screen.getByRole('button', { name: 'Add assignment' }));
    expect(onAdd).toHaveBeenCalledWith(row);
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await user.click(screen.getByRole('button', { name: 'Remove Member (Alpha)' }));
    expect(onRemove).toHaveBeenCalledWith(row, row.assignments[1]);
  });

  it('offers only Add assignment with no assignments', async () => {
    const user = userEvent.setup();
    renderRow({ assignments: [] });
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    expect(screen.getByRole('button', { name: 'Add assignment' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('disables the menu button while busy', () => {
    renderRow({}, { busy: true });
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeDisabled();
  });

  it('renders markup in names as text', () => {
    const { container } = renderRow({ name: '<b>Bold</b>' });
    expect(screen.getByText('<b>Bold</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('PlatformMemberRow phone card labels (BR-65)', () => {
  it('labels the data cells and leaves the actions cell unlabelled', () => {
    renderRow();
    expect(screen.getAllByRole('cell').map((c) => c.getAttribute('data-label'))).toEqual([
      'Name',
      'Email',
      'Roles',
      null,
    ]);
  });
});
