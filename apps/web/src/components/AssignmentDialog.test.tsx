import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { assignmentProjects, assignmentRoles } from '@/mocks/platform/assignment';
import { AssignmentDialog, type AssignmentDialogProps } from './AssignmentDialog';

function setup(over: Partial<AssignmentDialogProps> = {}) {
  const props: AssignmentDialogProps = {
    open: true,
    person: { name: 'Ada Lovelace', handle: 'ada' },
    roles: assignmentRoles,
    projects: assignmentProjects,
    values: { access: 'org', roleKey: '', projectId: '' },
    errors: {},
    saving: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<AssignmentDialog {...props} />);
  return props;
}

const roleNames = () =>
  within(screen.getByLabelText('Role'))
    .getAllByRole('option')
    .map((o) => o.textContent)
    .filter((t) => t !== 'Choose a role');

describe('AssignmentDialog', () => {
  it('shows the title and the person', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Add assignment' })).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada')).toBeTruthy();
  });

  it('defaults to the whole organization and offers all four roles', () => {
    setup();
    expect((screen.getByRole('radio', { name: 'Whole organization' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'One project' }) as HTMLInputElement).checked).toBe(false);
    expect(roleNames()).toEqual(['Owner', 'Admin', 'Member', 'Viewer']);
    expect(screen.queryByLabelText('Project')).toBeNull();
  });

  it('offers no Owner and shows the Project select for one project', () => {
    setup({ values: { access: 'project', roleKey: '', projectId: '' } });
    expect(roleNames()).toEqual(['Admin', 'Member', 'Viewer']);
    const options = within(screen.getByLabelText('Project')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['api', 'web', 'docs']);
  });

  it('clears a picked Owner when switching to one project', async () => {
    const p = setup({ values: { access: 'org', roleKey: 'owner', projectId: '' } });
    await userEvent.click(screen.getByRole('radio', { name: 'One project' }));
    expect(p.onChange).toHaveBeenCalledWith({ access: 'project', roleKey: '', projectId: '' });
  });

  it('keeps a non-owner role when switching access, and reports a role pick', async () => {
    const p = setup({ values: { access: 'org', roleKey: 'admin', projectId: '' } });
    await userEvent.click(screen.getByRole('radio', { name: 'One project' }));
    expect(p.onChange).toHaveBeenCalledWith({ access: 'project', roleKey: 'admin', projectId: '' });
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'viewer');
    expect(p.onChange).toHaveBeenCalledWith({ access: 'org', roleKey: 'viewer', projectId: '' });
  });

  it('submits and cancels', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add assignment' }));
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows field errors and the form error with the request id', () => {
    setup({
      values: { access: 'project', roleKey: '', projectId: '' },
      errors: { roleKey: 'Choose a role.', projectId: 'Choose a project.' },
      formError: { title: 'Could not add the assignment.', requestId: 'req-1' },
    });
    expect(screen.getByText('Choose a role.')).toBeTruthy();
    expect(screen.getByText('Choose a project.')).toBeTruthy();
    expect(screen.getByText('Could not add the assignment.')).toBeTruthy();
    expect(screen.getByText('Request ID: req-1')).toBeTruthy();
  });

  it('is not closable and cannot submit twice while saving', async () => {
    const p = setup({ saving: true });
    const adding = screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement;
    expect(adding.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the handle alone when there is no name', () => {
    setup({ person: { name: null, handle: 'ada' } });
    expect(screen.getByText('ada')).toBeTruthy();
  });
});
