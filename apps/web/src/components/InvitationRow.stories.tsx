import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { orgInvitationRows } from '@/mocks';
import type { OrgInvitationRowView } from '@/mocks/types';
import { DataTable } from './DataTable';
import { InvitationRow } from './InvitationRow';

const columns = ['Email', 'Role', 'Access', 'Status', 'Expires', 'Invited by', 'Actions'].map((h) => ({
  key: h,
  header: h,
}));
const meta = {
  title: 'Components/InvitationRow',
  component: InvitationRow,
  parameters: { layout: 'padded' },
  args: { onCopy: fn(), onResend: fn(), onRevoke: fn() },
  decorators: [
    (S) => (
      <DataTable columns={columns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof InvitationRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const at = (i: number): OrgInvitationRowView => {
  const r = orgInvitationRows[i];
  if (!r) throw new Error(`no invitation row ${i}`);
  return r;
};

export const Pending: Story = { args: { row: at(0) } };
export const ExpiringSoon: Story = { args: { row: at(1) } };
export const ExpiredRecently: Story = { args: { row: at(2) } };
export const ExpiredLongAgo: Story = { args: { row: at(3) } };
export const Accepted: Story = { args: { row: at(4) } };
export const Declined: Story = { args: { row: at(5) } };
export const Revoked: Story = { args: { row: at(6) } };
export const ProjectScope: Story = { args: { row: at(7) } };
export const LongEmail: Story = { args: { row: at(8) } };
export const InviterDeleted: Story = { args: { row: at(9) } };
