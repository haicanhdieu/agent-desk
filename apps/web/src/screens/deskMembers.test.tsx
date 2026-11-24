import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deskFrame, memberPickerOptions, pagedProjectMemberRows, projectMemberRows, projectRoleCards } from '@/mocks';
import { AddProjectMemberDialog } from '@/components';
import { DeskMembers, type DeskMembersProps } from './DeskMembers';

const frame = {
  ...deskFrame,
  links: {
    projects: '#projects',
    runs: '#runs',
    desk: '#desk',
    skills: '#skills',
    rules: '#rules',
    agent: '#agent',
    members: '#members',
    audit: '#audit',
  },
};
const base = {
  frame,
  orgName: 'Harbor Labs',
  projectName: 'invoicer-api',
  onAdd: vi.fn(),
  onInvite: vi.fn(),
  onChangeRole: vi.fn(),
  onRemove: vi.fn(),
};
const ready = (
  over: Partial<Extract<DeskMembersProps['state'], { kind: 'ready' }>> = {},
  props: Partial<DeskMembersProps> = {},
): DeskMembersProps => ({
  ...base,
  state: { kind: 'ready', rows: projectMemberRows, busyUserId: null, ...over },
  ...props,
});

describe('DeskMembers', () => {
  it('BR-4: ready shows the h1, the intro and the Name, Role and Actions columns', () => {
    render(<DeskMembers {...ready()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(
      screen.getByText('People with a role on this project. A role in Harbor Labs also applies here.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Role', 'Actions']);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(projectMemberRows.length);
  });

  it('BR-4: the page buttons read Invite people, then Add member, and call their handlers', async () => {
    const onAdd = vi.fn();
    const onInvite = vi.fn();
    render(<DeskMembers {...ready({}, { onAdd, onInvite })} />);
    const main = screen.getByRole('main');
    const names = within(main)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent)
      .filter((n) => n === 'Invite people' || n === 'Add member');
    expect(names).toEqual(['Invite people', 'Add member']);
    await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('BR-4: paging reads Showing 21-25 of 25 on page 2', () => {
    render(
      <DeskMembers
        {...ready({
          rows: pagedProjectMemberRows.slice(0, 5),
          pagination: { page: 2, pageSize: 20, total: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() },
        })}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 21–25 of 25');
  });

  it('BR-15: loading is a busy status with skeleton rows and no heading', () => {
    render(<DeskMembers {...base} state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('BR-15: error shows the banner, the request ID and Retry', async () => {
    const onRetry = vi.fn();
    render(<DeskMembers {...base} state={{ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry }} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req_01JD7Q3M8V2K/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('BR-15: no rows shows the empty state with its own Add member', async () => {
    const onAdd = vi.fn();
    render(<DeskMembers {...ready({ rows: [] }, { onAdd })} />);
    expect(screen.getByRole('heading', { name: 'No project roles yet' })).toBeInTheDocument();
    expect(screen.getByText('Add a member of Harbor Labs to give them a role on this project.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('BR-4: the busy row has its menu disabled and the others do not', () => {
    render(<DeskMembers {...ready({ busyUserId: 'user-tenant-4' })} />);
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Actions for Dana Wu' })).toBeEnabled();
  });

  it('BR-4: the row menu offers Change role and Remove from project for the row', async () => {
    const onChangeRole = vi.fn();
    const onRemove = vi.fn();
    render(<DeskMembers {...ready({}, { onChangeRole, onRemove })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Dana Wu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    expect(onChangeRole).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-tenant-5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Dana Wu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from project' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-tenant-5' }));
  });

  it('BR-1: the side menu marks Members as the current item', () => {
    render(<DeskMembers {...ready()} />);
    expect(screen.getByRole('link', { name: /Members/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the notice toast and renders dialogs passed as children', () => {
    render(
      <DeskMembers {...ready({}, { notice: { tone: 'ok', title: 'Mira Chen added as Member', onDismiss: vi.fn() } })}>
        <div>dialog slot</div>
      </DeskMembers>,
    );
    expect(screen.getByText('Mira Chen added as Member')).toBeInTheDocument();
    expect(screen.getByText('dialog slot')).toBeInTheDocument();
  });
  it('BR-5: an Add dialog child is labelled for the project, focuses Person, and the added notice is a status', () => {
    render(
      <DeskMembers {...ready({}, { notice: { tone: 'ok', title: 'Mira Chen added as Member', onDismiss: vi.fn() } })}>
        <AddProjectMemberDialog
          projectName="invoicer-api"
          orgName="Harbor Labs"
          picker={{
            query: '',
            onQueryChange: vi.fn(),
            options: memberPickerOptions,
            total: memberPickerOptions.length,
            hasMore: false,
            state: { kind: 'idle' },
            picked: null,
            onPick: vi.fn(),
            onLoadMore: vi.fn(),
          }}
          roles={projectRoleCards}
          roleId={null}
          onRoleChange={vi.fn()}
          errors={{}}
          saving={false}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </DeskMembers>,
    );
    expect(screen.getByRole('dialog', { name: 'Add member to invoicer-api' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByText('Mira Chen added as Member').closest('[role="status"]')).not.toBeNull();
  });
  it('BR-8: the remove confirm names the person and project, keeps the org role, and confirms or cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeskMembers
        {...ready(
          {},
          {
            removeConfirm: {
              memberName: 'Cleo Martin',
              projectName: 'invoicer-api',
              orgName: 'Harbor Labs',
              onConfirm,
              onCancel,
            },
          },
        )}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove Cleo Martin from invoicer-api?' });
    expect(
      within(dialog).getByText('They lose their role on this project. A role they hold in Harbor Labs stays.'),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('BR-8: while removing the confirm shows Removing… and cannot be closed or repeated', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <DeskMembers
        {...ready(
          {},
          {
            removeConfirm: {
              memberName: 'Cleo Martin',
              projectName: 'invoicer-api',
              orgName: 'Harbor Labs',
              busy: true,
              onConfirm,
              onCancel,
            },
          },
        )}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Remove Cleo Martin from invoicer-api?' });
    expect(within(dialog).getByRole('button', { name: 'Removing…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('BR-8: the gone notice is an error toast reading Member is no longer on this project', () => {
    render(
      <DeskMembers
        {...ready({}, { notice: { tone: 'error', title: 'Member is no longer on this project', onDismiss: vi.fn() } })}
      />,
    );
    expect(screen.getByText('Member is no longer on this project').closest('[role="status"]')).not.toBeNull();
  });
});
