import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangeRoleDialog } from '@/components';
import { memberRows, roleCards } from '@/mocks';
import { OrgMembers, type OrgMembersProps } from './OrgMembers';

const props = (over: Partial<OrgMembersProps> = {}): OrgMembersProps => ({
  state: { kind: 'ready', rows: memberRows.owner, busyUserId: null },
  onChangeRole: vi.fn(),
  onRemove: vi.fn(),
  ...over,
});

const rowElement = (name: string): HTMLElement => {
  const tr = screen.getByText(name).closest('tr');
  if (!tr) throw new Error(`no row for ${name}`);
  return tr;
};

describe('OrgMembers', () => {
  it('BR-24: loading is a busy status with no heading', () => {
    render(<OrgMembers {...props({ state: { kind: 'loading' } })} />);
    expect(screen.getByRole('status', { name: 'Loading' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('BR-24: the error shows the title and request id, and Retry calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<OrgMembers {...props({ state: { kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry } })} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText('Request ID: req_01JD7Q3M8V2K')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('BR-24: no rows shows No members', () => {
    render(<OrgMembers {...props({ state: { kind: 'ready', rows: [], busyUserId: null } })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('No members')).toBeInTheDocument();
  });

  it('forbidden shows the no-access notice and no table', () => {
    render(<OrgMembers {...props({ state: { kind: 'forbidden' } })} />);
    expect(screen.getByRole('heading', { level: 1, name: "You don't have access" })).toBeInTheDocument();
    expect(screen.getByText('Ask an owner of this organization to give you access.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('BR-1: ready lists every row under the four columns, and pagination reads Showing 21–25 of 25', () => {
    const rows = memberRows.paged.slice(20);
    render(
      <OrgMembers
        {...props({
          state: {
            kind: 'ready',
            rows,
            busyUserId: null,
            pagination: { page: 2, pageSize: 20, total: 25, onPageChange: vi.fn(), onPageSizeChange: vi.fn() },
          },
        })}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Role',
      'Project roles',
      'Actions',
    ]);
    expect(screen.getAllByRole('row')).toHaveLength(rows.length + 1);
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toHaveTextContent('Showing 21–25 of 25');
  });

  it('BR-1: each row shows name and handle, the role or No role, project roles, and the You tag on the caller', () => {
    render(<OrgMembers {...props()} />);
    const rowOf = (name: string) => within(rowElement(name));
    const alice = rowOf('Alice Doe');
    expect(alice.getByText('alice')).toBeInTheDocument();
    expect(alice.getByText('You')).toBeInTheDocument();
    expect(alice.getByText('Owner')).toBeInTheDocument();
    expect(screen.getAllByText('You')).toHaveLength(1);
    const cleo = rowOf('Cleo Martin');
    expect(cleo.getByText('invoicer-api (Admin), invoicer-web (Member)')).toBeInTheDocument();
    const eli = rowOf('Eli Ford');
    expect(eli.getByText('No role')).toBeInTheDocument();
    expect(eli.getByText('docs-site (Viewer)')).toBeInTheDocument();
  });

  it('an owner row on the admin view has no menu; other rows have one', () => {
    render(<OrgMembers {...props({ state: { kind: 'ready', rows: memberRows.admin, busyUserId: null } })} />);
    expect(screen.queryByRole('button', { name: 'Actions for Priya Raman' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toBeInTheDocument();
  });

  it('the row menu reports the row for Change role and Remove', async () => {
    const p = props();
    render(<OrgMembers {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Change role' }));
    expect(p.onChangeRole).toHaveBeenCalledWith(expect.objectContaining({ handle: 'cleo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from organization' }));
    expect(p.onRemove).toHaveBeenCalledWith(expect.objectContaining({ handle: 'cleo' }));
  });

  it('only the busy row has its menu disabled', () => {
    const busy = memberRows.owner[3];
    render(<OrgMembers {...props({ state: { kind: 'ready', rows: memberRows.owner, busyUserId: busy.userId } })} />);
    expect(screen.getByRole('button', { name: `Actions for ${busy.name}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Actions for Ben Okafor' })).toBeEnabled();
  });

  it('openMenuUserId opens that row menu', async () => {
    const other = memberRows.owner[3];
    render(<OrgMembers {...props({ openMenuUserId: other.userId })} />);
    expect(await screen.findByRole('button', { name: 'Change role' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from organization' })).toBeInTheDocument();
  });

  it.each([
    ['owner', memberRows.owner],
    ['admin', memberRows.admin],
  ] as const)('TC-9.2: on the %s caller own row there is a You tag and no menu', (_name, rows) => {
    const me = rows.find((r) => r.you);
    if (!me) throw new Error('fixture has no caller row');
    render(<OrgMembers {...props({ state: { kind: 'ready', rows, busyUserId: null } })} />);
    expect(within(rowElement(me.name)).getByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Actions for ${me.name}` })).not.toBeInTheDocument();
  });

  it('renders a hostile name as text, never as markup', () => {
    const evil = { ...memberRows.owner[1], name: '<img src=x onerror=alert(1)>', handle: 'evil' };
    const { container } = render(
      <OrgMembers {...props({ state: { kind: 'ready', rows: [evil], busyUserId: null } })} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('shows a dismissible notice and the dialog layer', async () => {
    const onDismiss = vi.fn();
    render(
      <OrgMembers {...props({ notice: { tone: 'ok', title: 'Role changed', onDismiss }, children: <p>layer</p> })} />,
    );
    expect(screen.getByText('layer')).toBeInTheDocument();
    const toast = screen.getByRole('status');
    expect(within(toast).getByText('Role changed')).toBeInTheDocument();
    await userEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('OrgMembers remove confirm', () => {
  const confirm = (over: Partial<NonNullable<OrgMembersProps['removeConfirm']>> = {}) => ({
    memberName: 'Cleo Martin',
    orgName: 'Harbor Labs',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  });

  it('TC-6.1: shows the title, body and the Cancel and Remove buttons', async () => {
    const removeConfirm = confirm();
    render(<OrgMembers {...props({ removeConfirm })} />);
    const dialog = screen.getByRole('dialog', { name: 'Remove Cleo Martin from Harbor Labs?' });
    expect(within(dialog).getByText('They lose access to every project in Harbor Labs.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(removeConfirm.onConfirm).toHaveBeenCalledTimes(1);
    expect(removeConfirm.onCancel).not.toHaveBeenCalled();
  });

  it('Remove is the danger button', () => {
    render(<OrgMembers {...props({ removeConfirm: confirm() })} />);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveClass('solid-danger');
  });

  it('Cancel and Escape call onCancel', async () => {
    const removeConfirm = confirm();
    render(<OrgMembers {...props({ removeConfirm })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.keyboard('{Escape}');
    expect(removeConfirm.onCancel).toHaveBeenCalledTimes(2);
  });

  it('while busy: Removing…, both buttons disabled, Escape ignored', async () => {
    const removeConfirm = confirm({ busy: true });
    render(<OrgMembers {...props({ removeConfirm })} />);
    const remove = screen.getByRole('button', { name: 'Removing…' });
    expect(remove).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(removeConfirm.onCancel).not.toHaveBeenCalled();
  });

  it('renders a hostile member name as text', () => {
    const memberName = '<b>x</b>';
    const { baseElement } = render(<OrgMembers {...props({ removeConfirm: confirm({ memberName }) })} />);
    expect(baseElement.querySelector('dialog b, [role=dialog] b')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Remove <b>x</b> from Harbor Labs?' })).toBeInTheDocument();
  });

  it('returns focus to the row menu button when the confirm closes', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <OrgMembers
          {...props({
            onRemove: () => setOpen(true),
            ...(open && { removeConfirm: confirm({ onCancel: () => setOpen(false) }) }),
          })}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Cleo Martin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from organization' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Cleo Martin' })).toHaveFocus();
  });

  it('shows the change role dialog passed as children over the list', () => {
    render(
      <OrgMembers
        {...props({
          children: (
            <ChangeRoleDialog
              memberName="Cleo Martin"
              orgName="Harbor Labs"
              options={roleCards.ownerCaller}
              current={roleCards.ownerCaller[2]?.roleId ?? null}
              self={false}
              currentIsOwner={false}
              saving={false}
              onSave={vi.fn()}
              onCancel={vi.fn()}
            />
          ),
        })}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Change role for Cleo Martin' })).toBeInTheDocument();
  });
});
