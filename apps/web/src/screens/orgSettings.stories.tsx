import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { memberRows } from '@/mocks';
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
