import type { Meta, StoryObj } from '@storybook/react-vite';
import { platformProjectRows } from '@/mocks';
import { DataTable } from './DataTable';
import { PlatformProjectRow, platformProjectColumns } from './PlatformProjectRow';

const meta = {
  title: 'Components/PlatformProjectRow',
  component: PlatformProjectRow,
  parameters: { layout: 'padded' },
  decorators: [
    (S) => (
      <DataTable columns={platformProjectColumns}>
        <S />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof PlatformProjectRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const first = platformProjectRows[0] ?? { id: 'p1', name: 'Alpha' };

export const Default: Story = { args: { row: first } };
export const LongId: Story = { args: { row: { id: `${first.id}-${'0123456789abcdef'.repeat(6)}`, name: first.name } } };
