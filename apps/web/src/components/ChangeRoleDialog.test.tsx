import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { accessProjectGrants, accessProjectRoleIds, accessProjects, projectRoleCards, roleCards } from '@/mocks';
import { ChangeRoleDialog, type ChangeRoleDialogProps } from './ChangeRoleDialog';

const owner = roleCards.ownerCaller;
const admin = roleCards.adminCaller;
const ids = { admin: owner[1]?.roleId ?? null, member: owner[2]?.roleId ?? null, owner: owner[0]?.roleId ?? null };

function setup(over: Partial<ChangeRoleDialogProps> = {}, opts: { plain?: boolean } = {}) {
  const handlers = { onSave: vi.fn(), onCancel: vi.fn() };
  const props: ChangeRoleDialogProps = {
    memberName: 'Dana Whitfield',
    orgName: 'Acme',
    options: admin,
    current: ids.member,
    self: false,
    currentIsOwner: false,
    saving: false,
    projectAccess: { grants: [], projects: accessProjects, roles: projectRoleCards, canEdit: true },
    ...handlers,
    ...over,
  };
  if (opts.plain) delete props.projectAccess;
  const view = render(<ChangeRoleDialog {...props} />);
  return { ...handlers, unmount: view.unmount };
}

describe('ChangeRoleDialog', () => {
  it('shows the title, a Role radio group and every description', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Change access for Dana Whitfield' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Role' });
    expect(within(group).getAllByRole('radio')).toHaveLength(admin.length);
    for (const c of admin) expect(within(group).getByText(c.description)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Owner' })).toBeNull();
  });

  it('offers the Owner card to owner callers', () => {
    setup({ options: owner });
    expect(screen.getByRole('radio', { name: 'Owner' })).toBeTruthy();
  });

  it('preselects and focuses the current role', () => {
    setup({ current: ids.admin });
    const r = screen.getByRole('radio', { name: 'Admin' }) as HTMLInputElement;
    expect(r.checked).toBe(true);
    expect(document.activeElement).toBe(r);
  });

  it('preselects No role when the member has none', () => {
    setup({ current: null });
    expect((screen.getByRole('radio', { name: 'No role' }) as HTMLInputElement).checked).toBe(true);
  });

  it('keeps Save access disabled until the choice differs, then saves the picked role', async () => {
    const h = setup();
    const save = screen.getByRole('button', { name: 'Save access' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: 'Viewer' }));
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(h.onSave).toHaveBeenCalledWith({ roleId: admin[2]?.roleId, projects: [] });
    await userEvent.click(screen.getByRole('radio', { name: 'Member' }));
    expect(save.disabled).toBe(true);
  });

  it('saves null for No role', async () => {
    const h = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'No role' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
    expect(h.onSave).toHaveBeenCalledWith({ roleId: null, projects: [] });
  });

  it('BR-3 picking Owner shows the status note, linked from the group', async () => {
    setup({ options: owner });
    expect(screen.queryByRole('status')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Owner' }));
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('Owners can change or remove every member, including other owners.');
    expect(screen.getByRole('group', { name: 'Role' }).getAttribute('aria-describedby')).toBe(note.id);
  });

  it('BR-42 the own owner row warns when a lower card is picked, not for Owner', async () => {
    setup({ options: owner, current: ids.owner, self: true, currentIsOwner: true });
    expect(screen.queryByText('You will lose owner rights in Acme.')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Admin' }));
    expect(screen.getByText('You will lose owner rights in Acme.')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Owner' }));
    expect(screen.queryByText('You will lose owner rights in Acme.')).toBeNull();
  });

  it('does not warn for a lower pick on another member or a non-owner row', async () => {
    setup({ options: owner, current: ids.owner, self: false, currentIsOwner: true });
    await userEvent.click(screen.getByRole('radio', { name: 'Admin' }));
    expect(screen.queryByText(/You will lose owner rights/)).toBeNull();
  });

  it('BR-5 lastOwner shows an alert Banner and keeps the dialog open', () => {
    setup({ options: owner, current: ids.owner, self: true, currentIsOwner: true, error: { kind: 'lastOwner' } });
    expect(screen.getByRole('alert').textContent).toContain('An organization needs at least one owner.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('forbidden shows You don’t have access with the request id', () => {
    setup({ error: { kind: 'forbidden', requestId: 'req-9' } });
    expect(screen.getByRole('alert').textContent).toContain("You don't have access");
    expect(screen.getByText('Request ID: req-9')).toBeTruthy();
  });

  it('forbidden without a request id omits the Request ID line', () => {
    setup({ error: { kind: 'forbidden' } });
    expect(screen.queryByText(/Request ID/)).toBeNull();
  });

  it('while saving the button reads Saving… and Cancel and Escape do nothing', async () => {
    const h = setup({ saving: true });
    expect((screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('Escape and Cancel cancel when not saving, and focus returns to the opener', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const h = setup();
    await userEvent.keyboard('{Escape}');
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).toHaveBeenCalledTimes(2);
    h.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('renders the member name as text, never HTML', () => {
    setup({ memberName: '<img src=x onerror=alert(1)>' });
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull();
    expect(screen.getByText('Change access for <img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('without project access (the project Members page) it is the plain role dialog', async () => {
    const h = setup({}, { plain: true });
    expect(screen.getByRole('dialog', { name: 'Change role for Dana Whitfield' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Project access' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Viewer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save role' }));
    expect(h.onSave).toHaveBeenCalledWith({ roleId: admin[2]?.roleId, projects: [] });
  });

  describe('project access', () => {
    const grants = accessProjectGrants;
    const access = (over: Partial<NonNullable<ChangeRoleDialogProps['projectAccess']>>) => ({
      grants: [],
      projects: accessProjects,
      roles: projectRoleCards,
      canEdit: true,
      ...over,
    });
    const section = () => screen.getByRole('group', { name: 'Project access' });
    const rowFor = (project: string) => within(section()).getByRole('listitem', { name: project });

    it('lists each project grant with its role and a remove button, and says so when there is none', () => {
      const { unmount } = setup({ projectAccess: access({ grants }) });
      expect(within(section()).getAllByRole('listitem')).toHaveLength(2);
      expect(
        (within(rowFor('invoicer-api')).getByRole('combobox', { name: 'Role in invoicer-api' }) as HTMLSelectElement)
          .value,
      ).toBe(accessProjectRoleIds.admin);
      expect(
        within(rowFor('invoicer-web')).getByRole('button', { name: 'Remove access to invoicer-web' }),
      ).toBeTruthy();
      unmount();
      setup();
      expect(within(section()).getByText('No project access.')).toBeTruthy();
    });

    it('offers Admin, Member and Viewer for a project, never Owner', () => {
      setup({ projectAccess: access({ grants }) });
      const select = within(rowFor('invoicer-api')).getByRole('combobox', { name: 'Role in invoicer-api' });
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Admin', 'Member', 'Viewer']);
    });

    it('saves a changed project role as the full wanted state, keeping the assignment it replaces', async () => {
      const h = setup({ projectAccess: access({ grants }) });
      const save = screen.getByRole('button', { name: 'Save access' }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      await userEvent.selectOptions(
        within(rowFor('invoicer-api')).getByRole('combobox', { name: 'Role in invoicer-api' }),
        accessProjectRoleIds.viewer,
      );
      expect(save.disabled).toBe(false);
      await userEvent.click(save);
      expect(h.onSave).toHaveBeenCalledWith({
        roleId: ids.member,
        projects: [
          {
            assignmentId: grants[0]?.assignmentId,
            projectId: grants[0]?.projectId,
            roleId: accessProjectRoleIds.viewer,
          },
          {
            assignmentId: grants[1]?.assignmentId,
            projectId: grants[1]?.projectId,
            roleId: accessProjectRoleIds.member,
          },
        ],
      });
    });

    it('removes a grant and saves without it', async () => {
      const h = setup({ projectAccess: access({ grants }) });
      await userEvent.click(
        within(rowFor('invoicer-web')).getByRole('button', { name: 'Remove access to invoicer-web' }),
      );
      expect(within(section()).queryByRole('listitem', { name: 'invoicer-web' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
      expect(h.onSave).toHaveBeenCalledWith({
        roleId: ids.member,
        projects: [
          {
            assignmentId: grants[0]?.assignmentId,
            projectId: grants[0]?.projectId,
            roleId: accessProjectRoleIds.admin,
          },
        ],
      });
    });

    it('keeps Save access disabled when a removed grant is added back with the same role', async () => {
      setup({ projectAccess: access({ grants }) });
      await userEvent.click(
        within(rowFor('invoicer-web')).getByRole('button', { name: 'Remove access to invoicer-web' }),
      );
      const save = screen.getByRole('button', { name: 'Save access' }) as HTMLButtonElement;
      expect(save.disabled).toBe(false);
      const web = accessProjects.find((p) => p.label === 'invoicer-web');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project to add' }), web?.id ?? '');
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Role in the project to add' }),
        accessProjectRoleIds.member,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
      expect(save.disabled).toBe(true);
    });

    it('adds a project with a role (Member by default) and takes it out of the picker', async () => {
      const h = setup({ projectAccess: access({ grants }) });
      const picker = screen.getByRole('combobox', { name: 'Project to add' }) as HTMLSelectElement;
      const labels = within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent);
      expect(labels).not.toContain('invoicer-api');
      expect(labels).toContain('storefront');
      const storefront = accessProjects.find((p) => p.label === 'storefront');
      await userEvent.selectOptions(picker, storefront?.id ?? '');
      await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
      expect(within(section()).getByRole('listitem', { name: 'storefront' })).toBeTruthy();
      expect(
        within(screen.getByRole('combobox', { name: 'Project to add' })).queryByRole('option', { name: 'storefront' }),
      ).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
      expect(h.onSave).toHaveBeenCalledWith({
        roleId: ids.member,
        projects: [
          expect.objectContaining({ assignmentId: grants[0]?.assignmentId }),
          expect.objectContaining({ assignmentId: grants[1]?.assignmentId }),
          { projectId: storefront?.id, roleId: accessProjectRoleIds.member },
        ],
      });
    });

    it('keeps Add project off until a project is picked', async () => {
      setup();
      expect((screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows a read-only project list, with no controls, when the caller may not change project grants', () => {
      setup({ projectAccess: access({ grants, canEdit: false }) });
      expect(within(section()).getByText('Admin')).toBeTruthy();
      expect(within(section()).queryByRole('combobox')).toBeNull();
      expect(within(section()).queryByRole('button')).toBeNull();
    });

    it('disables every project control while saving', () => {
      setup({ projectAccess: access({ grants }), saving: true });
      for (const c of [...within(section()).getAllByRole('combobox'), ...within(section()).getAllByRole('button')]) {
        expect((c as HTMLButtonElement | HTMLSelectElement).disabled).toBe(true);
      }
    });
  });
});
