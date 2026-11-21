import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { inviteProjectOptions, inviteRoleOptions, invitationLink } from '@/mocks';
import { InviteDialog, type InviteDialogProps, type InviteDialogStep, type InviteDialogValues } from './InviteDialog';

const values: InviteDialogValues = { email: '', roleId: '', scope: 'org', projectIds: [] };
const form = (over: Partial<Extract<InviteDialogStep, { kind: 'form' }>> = {}): InviteDialogStep => ({
  kind: 'form',
  values,
  errors: {},
  saving: false,
  ...over,
});

function setup(over: Partial<InviteDialogProps> = {}) {
  const handlers = { onChange: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(), onCopy: vi.fn(), onDone: vi.fn() };
  const props: InviteDialogProps = {
    open: true,
    step: form(),
    roles: inviteRoleOptions.owner,
    projects: inviteProjectOptions,
    projectsOnly: false,
    ...handlers,
    ...over,
  };
  render(<InviteDialog {...props} />);
  return handlers;
}

describe('InviteDialog', () => {
  it('BR-29 projectsOnly hides Whole organization and lists only the given projects', () => {
    const only = inviteProjectOptions.slice(0, 1);
    setup({ projectsOnly: true, projects: only, roles: inviteRoleOptions.projectAdmin });
    expect(screen.queryByText('Whole organization')).toBeNull();
    expect(screen.getByText('Some projects')).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: only[0]?.label })).toBeTruthy();
  });

  it('offers both access cards and every project when not projectsOnly', async () => {
    const h = setup({ step: form({ values: { ...values, scope: 'projects' } }) });
    expect(screen.getByRole('radio', { name: 'Whole organization' })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(inviteProjectOptions.length);
    await userEvent.click(screen.getByRole('checkbox', { name: 'api' }));
    expect(h.onChange).toHaveBeenCalledWith({
      ...values,
      scope: 'projects',
      projectIds: [inviteProjectOptions[0]?.id],
    });
  });

  it('the role select offers exactly the given roles', () => {
    setup({ roles: inviteRoleOptions.orgAdmin });
    const options = within(screen.getByLabelText('Role')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(inviteRoleOptions.orgAdmin.map((r) => r.label));
  });

  it('renders field errors with aria-invalid', () => {
    setup({ step: form({ errors: { email: 'Enter a valid email.', roleId: 'Choose a role.' } }) });
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Role').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Enter a valid email.')).toBeTruthy();
  });

  it('shows the project error and the form banner', () => {
    setup({
      step: form({
        values: { ...values, scope: 'projects' },
        errors: { projectIds: 'Choose at least one project.' },
        formError: 'Could not create the invitation.',
      }),
    });
    expect(screen.getByText('Choose at least one project.')).toBeTruthy();
    expect(screen.getByText('Could not create the invitation.')).toBeTruthy();
  });

  it('focuses the first field on open and reports typing', async () => {
    const h = setup();
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(h.onChange).toHaveBeenCalledWith({ ...values, email: 'a' });
  });

  it('submits and cancels', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('saving reads Creating… and disables the actions', () => {
    setup({ step: form({ saving: true }) });
    expect((screen.getByRole('button', { name: 'Creating…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('while saving, Cancel is disabled and Escape does not dismiss the dialog', async () => {
    const h = setup({ step: form({ saving: true }) });
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    await userEvent.click(cancel);
    await userEvent.keyboard('{Escape}');
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('Escape still cancels when not saving', async () => {
    const h = setup();
    await userEvent.keyboard('{Escape}');
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('choosing Whole organization clears the ticked projects', async () => {
    const ticked = { ...values, scope: 'projects' as const, projectIds: [inviteProjectOptions[0]?.id ?? ''] };
    const h = setup({ step: form({ values: ticked }) });
    await userEvent.click(screen.getByRole('radio', { name: 'Whole organization' }));
    expect(h.onChange).toHaveBeenCalledWith({ ...ticked, scope: 'org', projectIds: [] });
  });

  it('projectsOnly: ticking a project reports scope projects even when values.scope is org', async () => {
    const h = setup({ projectsOnly: true, roles: inviteRoleOptions.projectAdmin, step: form({ values }) });
    await userEvent.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    expect(h.onChange).toHaveBeenCalledWith(expect.objectContaining({ scope: 'projects' }));
  });

  it('BR-29 projectsOnly never reports scope org when typing or choosing a role', async () => {
    const h = setup({ projectsOnly: true, roles: inviteRoleOptions.projectAdmin, step: form({ values }) });
    await userEvent.type(screen.getByLabelText('Email'), 'a');
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'a', scope: 'projects' }));
    await userEvent.selectOptions(screen.getByLabelText('Role'), inviteRoleOptions.projectAdmin[0]?.id ?? '');
    expect(h.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'projects' }));
  });

  it('the created step shows the copy and focuses Copy link', async () => {
    const step: InviteDialogStep = {
      kind: 'created',
      email: 'a@x.dev',
      expiresOn: 'Nov 23, 2026',
      link: invitationLink,
    };
    const h = setup({ step });
    expect(screen.getByRole('heading', { name: 'Invitation created' })).toBeTruthy();
    expect(
      screen.getByText('Send this link to a@x.dev. It works only for that email and expires on Nov 23, 2026.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Copy link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(h.onCopy).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.onDone).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
