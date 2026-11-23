import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { memberRows } from '@/mocks';
import type { MemberRowView } from '@/mocks/types';
import { DataTable } from './DataTable';
import { MemberRow, memberColumns } from './MemberRow';

const meta = {
  title: 'Components/MemberRow',
  component: MemberRow,
  parameters: { layout: 'padded' },
  args: { onChangeRole: fn(), onRemove: fn() },
  decorators: [
    (S) => (
      <DataTable columns={memberColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof MemberRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const find = (rows: MemberRowView[], pick: (r: MemberRowView) => boolean): MemberRowView => {
  const r = rows.find(pick);
  if (!r) throw new Error('no matching member fixture');
  return r;
};
const owner = memberRows.owner;
const byHandle = (handle: string) => find(owner, (r) => r.handle === handle);

export const Owner: Story = { args: { row: byHandle('priya') } };
export const Admin: Story = { args: { row: byHandle('ben') } };
/** A short-name member: the fixture's plain member rows are the long-name one, so the role is set here. */
export const Member: Story = { args: { row: { ...byHandle('dana'), role: { key: 'member', name: 'Member' } } } };
export const Viewer: Story = { args: { row: byHandle('dana') } };
export const NoRole: Story = { args: { row: byHandle('eli') } };
export const ProjectRoles: Story = { args: { row: byHandle('cleo') } };
/** Own row: Change role only, no Remove (BR-9). */
export const You: Story = { args: { row: byHandle('alice') } };
/** An owner caller sees actions on another owner's row: the menu is opened to show Change role and Remove. */
export const OwnerRowForOwner: Story = {
  args: { row: byHandle('priya') },
  decorators: [
    (S) => (
      <div style={{ minHeight: 180 }}>
        <S />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Actions for/ }));
  },
};
/** An admin caller sees no actions on an owner's row (BR-4): no menu button. */
export const OwnerRowForAdmin: Story = { args: { row: find(memberRows.admin, (r) => r.handle === 'priya') } };
export const LongName: Story = { args: { row: byHandle('maximilian-featherstonehaugh-montgomery') } };
export const Busy: Story = { args: { row: byHandle('ben'), busy: true } };
