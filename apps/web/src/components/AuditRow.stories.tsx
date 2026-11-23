import type { Meta, StoryObj } from '@storybook/react-vite';
import { auditRows } from '@/mocks';
import type { AuditRowView } from '@/mocks/types';
import { AuditRow, auditColumns } from './AuditRow';
import { DataTable } from './DataTable';

const meta = {
  title: 'Components/AuditRow',
  component: AuditRow,
  parameters: { layout: 'padded' },
  decorators: [
    (S) => (
      <DataTable columns={auditColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof AuditRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const at = (i: number): AuditRowView => {
  const r = auditRows[i];
  if (!r) throw new Error(`no audit row ${i}`);
  return r;
};

export const RoleChanged: Story = { args: { row: at(0) } };
export const MadeOwner: Story = { args: { row: at(1) } };
export const SlugChanged: Story = { args: { row: at(2) } };
export const OrgRenamed: Story = { args: { row: at(3) } };
export const MemberRemoved: Story = { args: { row: at(4) } };
export const InvitationCreated: Story = { args: { row: at(5) } };
export const GenericRequest: Story = { args: { row: at(6) } };
export const PlatformAdminActor: Story = { args: { row: at(7) } };
export const DeletedActor: Story = { args: { row: at(8) } };
export const LongText: Story = { args: { row: at(9) } };
