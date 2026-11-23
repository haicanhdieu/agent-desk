import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { platformAdminRows, type PlatformAdminRowView } from '@/mocks/platform/admins';
import { DataTable } from './DataTable';
import { PlatformAdminRow, platformAdminColumns } from './PlatformAdminRow';

const meta = {
  title: 'Components/PlatformAdminRow',
  component: PlatformAdminRow,
  parameters: { layout: 'padded' },
  args: { onRevoke: fn() },
  decorators: [
    (S) => (
      <DataTable columns={platformAdminColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof PlatformAdminRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const pick = (pred: (r: PlatformAdminRowView) => boolean): PlatformAdminRowView => {
  const r = platformAdminRows.find(pred);
  if (!r) throw new Error('no matching platform admin fixture');
  return r;
};
const other = pick((r) => !r.you && !r.neverSignedIn);

export const Default: Story = { args: { row: other } };
export const You: Story = { args: { row: pick((r) => r.you) } };
export const NeverSignedIn: Story = { args: { row: pick((r) => r.neverSignedIn) } };
/** The last working admin: Revoke is disabled with the reason beside it. */
export const LastAdmin: Story = { args: { row: { ...other, lastWorkingAdmin: true } } };
export const Busy: Story = { args: { row: other, busy: true } };
