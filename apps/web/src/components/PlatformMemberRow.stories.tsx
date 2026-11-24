import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { platformMemberRows } from '@/mocks';
import type { PlatformMemberRowView } from '@/mocks';
import { DataTable } from './DataTable';
import { PlatformMemberRow, platformMemberColumns } from './PlatformMemberRow';

const meta = {
  title: 'Components/PlatformMemberRow',
  component: PlatformMemberRow,
  parameters: { layout: 'padded' },
  args: { onAdd: fn(), onRemove: fn() },
  decorators: [
    (S) => (
      <DataTable columns={platformMemberColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof PlatformMemberRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const find = (pick: (r: PlatformMemberRowView) => boolean): PlatformMemberRowView => {
  const r = platformMemberRows.find(pick);
  if (!r) throw new Error('no matching platform member fixture');
  return r;
};

const several = find((r) => r.assignments.length > 1);

export const Default: Story = { args: { row: several } };
export const NoAssignment: Story = { args: { row: find((r) => r.assignments.length === 0) } };
export const NoName: Story = { args: { row: find((r) => r.name === null) } };
export const MenuOpen: Story = {
  args: { row: several },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: `Actions for ${several.name}` }));
    await expect(within(document.body).getByRole('button', { name: 'Add assignment' })).toBeInTheDocument();
  },
};
export const Busy: Story = { args: { row: several, busy: true } };
export const LongName: Story = {
  args: {
    row: {
      ...several,
      name: 'Alexandrina Montgomery-Featherstonehaugh '.repeat(4).trim(),
      email: `${'very.long.address.'.repeat(6)}@example.test`,
      assignments: several.assignments.map((a) => ({
        ...a,
        label: `${a.label} ${'on a very long project name '.repeat(3)}`,
      })),
    },
  },
};
