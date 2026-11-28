import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectMemberRowView } from '@/mocks/types';
import { ProjectMemberRow, projectMemberColumns } from './ProjectMemberRow';

const base: ProjectMemberRowView = {
  userId: 'u1',
  name: 'Cleo Martin',
  handle: 'cleo',
  you: false,
  roles: 'Member',
  orgRoles: '',
  inherited: false,
};

function renderRow(over: Partial<ProjectMemberRowView> = {}, props: { busy?: boolean } = {}) {
  const row = { ...base, ...over };
  const handlers = { onChangeRole: vi.fn(), onRemove: vi.fn() };
  const view = render(
    <table>
      <tbody>
        <ProjectMemberRow row={row} {...handlers} {...props} />
      </tbody>
    </table>,
  );
  return { row, ...handlers, ...view };
}

describe('ProjectMemberRow', () => {
  it('names the columns Name, Role and a screen-reader Actions', () => {
    expect(projectMemberColumns.map((c) => c.key)).toEqual(['name', 'roles', 'actions']);
    expect(projectMemberColumns[0]?.header).toBe('Name');
    expect(projectMemberColumns[1]?.header).toBe('Role');
  });

  it('shows the name with the handle in muted mono', () => {
    renderRow();
    expect(screen.getByText('Cleo Martin')).toHaveAttribute('title', 'Cleo Martin');
    expect(screen.getByText('cleo')).toHaveClass('handle');
  });

  it('shows the name only, with no empty handle element, when the handle is null', () => {
    const { container } = renderRow({ handle: null });
    expect(screen.getByText('Cleo Martin')).toBeInTheDocument();
    expect(container.querySelector('.handle')).toBeNull();
  });

  it('tags the own row with You and gives it no actions menu', () => {
    renderRow({ you: true });
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('offers Change role and Remove from project on other rows', async () => {
    const user = userEvent.setup();
    const { row, onChangeRole, onRemove } = renderRow();
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    expect(onChangeRole).toHaveBeenCalledWith(row);
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await user.click(screen.getByRole('button', { name: 'Remove from project' }));
    expect(onRemove).toHaveBeenCalledWith(row);
  });

  it('styles Remove from project as the danger action', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    expect(screen.getByRole('button', { name: 'Remove from project' })).toHaveClass('danger');
    expect(screen.getByRole('button', { name: 'Change role' })).not.toHaveClass('danger');
  });

  it('disables the menu button while busy', () => {
    renderRow({}, { busy: true });
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeDisabled();
  });

  it('renders several roles as one list', () => {
    renderRow({ roles: 'Member, Viewer' });
    expect(screen.getByText('Member, Viewer')).toBeInTheDocument();
  });

  it('labels an org-wide role Organization and gives the inherited row no actions menu', () => {
    renderRow({ roles: '', orgRoles: 'Viewer', inherited: true });
    expect(screen.getByText('Viewer')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('shows both the project role and the labelled org role, with actions for the project part', () => {
    renderRow({ roles: 'Admin', orgRoles: 'Viewer', inherited: false });
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeInTheDocument();
  });

  it('renders a name with markup as text', () => {
    const { container } = renderRow({ name: '<b>Bold</b>' });
    expect(screen.getByText('<b>Bold</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('gives a long name a title and an ellipsis class', () => {
    const name = 'Alexandria Montgomery-Featherstonehaugh '.repeat(3).trim();
    renderRow({ name });
    expect(screen.getByText(name)).toHaveAttribute('title', name);
    expect(screen.getByText(name)).toHaveClass('nameText');
  });
});

describe('ProjectMemberRow phone card labels (BR-65)', () => {
  it('labels the Name and Role cells and leaves the actions cell unlabelled', () => {
    renderRow();
    expect(screen.getAllByRole('cell').map((c) => c.getAttribute('data-label'))).toEqual(['Name', 'Role', null]);
  });
});
