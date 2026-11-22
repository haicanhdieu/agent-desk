import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { AppShell, ChangeRoleDialog, type ChangeRoleDialogProps } from '@/components';
import { memberRows, orgSettingsFixtures, roleCards } from '@/mocks';
import type { MemberRowView } from '@/mocks/types';
import { OrgGeneral as OrgGeneralScreen, type OrgGeneralProps } from './OrgGeneral';
import { OrgMembers as OrgMembersScreen, type OrgMembersProps } from './OrgMembers';
import { OrgSettingsFrame } from './orgSettingsFrame';
import { viewport } from './viewports';

const noop = () => undefined;

const meta = {
  title: 'Screens/OrgSettings',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    (S) => (
      <AppShell height={900} topBar={null}>
        <S />
      </AppShell>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const members = (
  state: OrgMembersProps['state'],
  extra: Partial<OrgMembersProps> = {},
  frame: Pick<Parameters<typeof OrgSettingsFrame>[0], 'role' | 'sideMenu'> = { role: 'owner' },
) => (
  <OrgSettingsFrame {...frame} active="members">
    <OrgMembersScreen state={state} onChangeRole={noop} onRemove={noop} {...extra} />
  </OrgSettingsFrame>
);
const ready = (
  rows: OrgMembersProps['state'] extends infer S ? (S extends { kind: 'ready'; rows: infer R } ? R : never) : never,
  busyUserId: string | null = null,
  pagination?: Extract<OrgMembersProps['state'], { kind: 'ready' }>['pagination'],
): OrgMembersProps['state'] => ({ kind: 'ready', rows, busyUserId, ...(pagination && { pagination }) });

const ownerRows = memberRows.owner;
const caller = ownerRows.find((r) => r.you);
const other = ownerRows.find((r) => r.handle === 'cleo');
if (!caller || !other) throw new Error('member fixtures lost the caller or Cleo');

export const OrgMembers: Story = {
  name: 'Members, owner: several owners, No role, project roles',
  render: () => members(ready(ownerRows)),
};
export const OrgMembersAdmin: Story = {
  name: 'Members, org admin: owner rows have no actions',
  render: () => members(ready(memberRows.admin), {}, { role: 'admin' }),
};
export const OrgMembersPaged: Story = {
  name: 'Members, page 2 of 2',
  render: () =>
    members(
      ready(memberRows.paged.slice(20), null, {
        page: 2,
        pageSize: 20,
        total: 25,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
    ),
};
export const OrgMembersEmpty: Story = {
  name: 'Members, empty (only via a clamped page)',
  render: () => members(ready([])),
};
export const OrgMembersLoading: Story = {
  name: 'Members, loading',
  render: () => members({ kind: 'loading' }),
};
export const OrgMembersError: Story = {
  name: 'Members, failed to load',
  render: () => members({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const OrgMembersForbidden: Story = {
  name: 'Members, no access (member or viewer): no side menu',
  render: () => members({ kind: 'forbidden' }, {}, { role: 'member', sideMenu: false }),
};
export const OrgMembersRowMenu: Story = {
  name: 'Members, row menu on another member',
  render: () => members(ready(ownerRows), { openMenuUserId: other.userId }),
};
export const OrgMembersRowMenuSelf: Story = {
  name: "Members, row menu on the caller's own row: no Remove",
  render: () => members(ready(ownerRows), { openMenuUserId: caller.userId }),
};
export const OrgMembersBusy: Story = {
  name: 'Members, request in flight: row menu disabled',
  render: () => members(ready(ownerRows, other.userId)),
};

const orgName = orgSettingsFixtures.org.name;
const find = (rows: MemberRowView[], handle: string): MemberRowView => {
  const m = rows.find((r) => r.handle === handle);
  if (!m) throw new Error(`member fixtures lost ${handle}`);
  return m;
};
const cardId = (key: string) => roleCards.ownerCaller.find((c) => c.key === key)?.roleId ?? null;

/** The change-role dialog over the list, for the member `target`. */
const changeRole = (
  target: MemberRowView,
  over: Partial<ChangeRoleDialogProps> = {},
  rows: MemberRowView[] = ownerRows,
  frame: Pick<Parameters<typeof OrgSettingsFrame>[0], 'role' | 'sideMenu'> = { role: 'owner' },
) =>
  members(
    ready(rows),
    {
      children: (
        <ChangeRoleDialog
          memberName={target.name}
          orgName={orgName}
          options={roleCards.ownerCaller}
          current={target.role ? cardId(target.role.key) : null}
          self={target.you}
          currentIsOwner={target.role?.key === 'owner'}
          saving={false}
          onSave={noop}
          onCancel={noop}
          {...over}
        />
      ),
    },
    frame,
  );
const pick =
  (name: string): Story['play'] =>
  async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('radio', { name }));
  };

const cleo = other;
const ben = find(ownerRows, 'ben');
const dana = find(ownerRows, 'dana');
const eli = find(ownerRows, 'eli');
const priya = find(ownerRows, 'priya');

export const OrgMembersChangeRole: Story = {
  name: 'Change role, owner caller: Owner card offered, current role preselected',
  render: () => changeRole(cleo),
};
export const OrgMembersChangeRoleAdmin: Story = {
  name: 'Change role, org admin caller: no Owner card',
  render: () =>
    changeRole(find(memberRows.admin, 'dana'), { options: roleCards.adminCaller }, memberRows.admin, { role: 'admin' }),
};
export const OrgMembersMakeOwner: Story = {
  name: 'Change role, owner picks Owner: inline note',
  render: () => changeRole(ben),
  play: pick('Owner'),
};
export const OrgMembersStepDown: Story = {
  name: 'Change role, owner on own row picks Admin: step-down warning',
  render: () => changeRole(caller),
  play: pick('Admin'),
};
export const OrgMembersChangeRoleSaving: Story = {
  name: 'Change role, saving',
  render: () => changeRole(eli, { saving: true }),
};
export const OrgMembersChangeRoleError: Story = {
  name: 'Change role, refused (403): Banner in the dialog',
  render: () => changeRole(dana, { error: { kind: 'forbidden', requestId: 'req_01JD7Q3M8V2K' } }),
};
const soleOwnerRows = ownerRows.map((r) =>
  r.userId === priya.userId ? { ...r, role: { key: 'admin' as const, name: 'Admin' } } : r,
);
export const OrgMembersLastOwner: Story = {
  name: 'Change role, sole owner steps down: 409, dialog stays open',
  render: () => changeRole(caller, { error: { kind: 'lastOwner' } }, soleOwnerRows),
  play: pick('Member'),
};
export const OrgMembersRoleChanged: Story = {
  name: 'Members, role changed: list refetched, toast',
  render: () =>
    members(
      ready(
        ownerRows.map((r) => (r.userId === cleo.userId ? { ...r, role: { key: 'admin' as const, name: 'Admin' } } : r)),
      ),
      { notice: { tone: 'ok', title: 'Role changed', onDismiss: noop } },
    ),
};
export const OrgMembersGone: Story = {
  name: 'Members, member removed meanwhile: dialog closed, list refetched, error toast',
  render: () =>
    members(ready(ownerRows.filter((r) => r.userId !== dana.userId)), {
      notice: { tone: 'error', title: 'Member is no longer in the organization', onDismiss: noop },
    }),
};
const removeConfirm = (over: Partial<NonNullable<OrgMembersProps['removeConfirm']>> = {}) => ({
  memberName: cleo.name,
  orgName,
  onConfirm: noop,
  onCancel: noop,
  ...over,
});
export const OrgMembersRemoveConfirm: Story = {
  name: 'Members, remove confirmation',
  render: () => members(ready(ownerRows), { removeConfirm: removeConfirm() }),
};
export const OrgMembersRemoving: Story = {
  name: 'Members, removing',
  render: () => members(ready(ownerRows, cleo.userId), { removeConfirm: removeConfirm({ busy: true }) }),
};
export const OrgMembersRemoved: Story = {
  name: 'Members, removed: list refetched, toast',
  render: () =>
    members(ready(ownerRows.filter((r) => r.userId !== cleo.userId)), {
      notice: { tone: 'ok', title: `${cleo.name} removed`, onDismiss: noop },
    }),
};
export const OrgMembersRemoveLastOwner: Story = {
  name: 'Members, remove refused (409 last owner): toast, list refetched',
  render: () =>
    members(ready(soleOwnerRows), {
      notice: { tone: 'error', title: 'The organization needs at least one owner', onDismiss: noop },
    }),
};

const general = (
  over: Partial<OrgGeneralProps> = {},
  frame: Pick<Parameters<typeof OrgSettingsFrame>[0], 'role' | 'sideMenu' | 'orgName'> = { role: 'owner' },
) => (
  <OrgSettingsFrame {...frame} active="general">
    <OrgGeneralScreen
      state={{ kind: 'ready' }}
      name={{ value: orgSettingsFixtures.org.name, onChange: noop }}
      slug={{ value: orgSettingsFixtures.org.slug, onChange: noop }}
      dirty={false}
      saving={false}
      onSave={noop}
      {...over}
    />
  </OrgSettingsFrame>
);
const renamed = `${orgSettingsFixtures.org.name} Group`;
const longName =
  'Harbor Labs Platform Engineering, Developer Experience and Internal Tooling Group for North America and Europe';
const slugFormat = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';

export const OrgGeneral: Story = {
  name: 'General, ready: nothing changed, Save disabled',
  render: () => general(),
};
export const OrgGeneralSaving: Story = {
  name: 'General, saving a new name',
  render: () => general({ name: { value: renamed, onChange: noop }, dirty: true, saving: true }),
};
export const OrgGeneralSaved: Story = {
  name: 'General, saved: switcher shows the new name, toast',
  render: () =>
    general(
      {
        name: { value: renamed, onChange: noop },
        notice: { tone: 'ok', title: 'Organization updated', onDismiss: noop },
      },
      { role: 'owner', orgName: renamed },
    ),
};
export const OrgGeneralFieldErrors: Story = {
  name: 'General, field errors: empty name, bad URL format',
  render: () =>
    general({
      name: { value: '', error: 'Enter a name.', onChange: noop },
      slug: { value: '-harbor-', error: slugFormat, onChange: noop },
      dirty: true,
    }),
};
export const OrgGeneralNameTooLong: Story = {
  name: 'General, field error: name over 100 characters',
  render: () =>
    general({
      name: { value: longName, error: 'Use 100 characters or fewer.', onChange: noop },
      dirty: true,
    }),
};
export const OrgGeneralSlugTaken: Story = {
  name: 'General, field error: URL taken by another org, input kept',
  render: () =>
    general({
      slug: { value: 'northwind', error: 'This URL is taken. Try another.', onChange: noop },
      dirty: true,
    }),
};
export const OrgGeneralSlugConfirm: Story = {
  name: 'General, URL change confirmation',
  render: () =>
    general({
      slug: { value: 'harbor', onChange: noop },
      dirty: true,
      slugConfirm: { from: orgSettingsFixtures.org.slug, to: 'harbor', onConfirm: noop, onCancel: noop },
    }),
};
export const OrgGeneralFormError: Story = {
  name: 'General, form error with request ID, input kept',
  render: () =>
    general({
      name: { value: renamed, onChange: noop },
      dirty: true,
      formError: { title: 'Internal server error', requestId: 'req_01JD7Q3M8V2K' },
    }),
};
export const OrgGeneralForbidden: Story = {
  name: 'General URL opened by a project admin: no access inside the layout',
  render: () => general({ state: { kind: 'forbidden' } }, { role: 'projectAdmin' }),
};
