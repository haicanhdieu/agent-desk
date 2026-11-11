import type { Meta, StoryObj } from '@storybook/react-vite';
import { ignored } from '@/mocks';
import { DataTable } from './DataTable';
import { IgnoredRow } from './IgnoredRow';

const columns = ['Time', 'Ticket', 'Command', 'Author', 'Why nothing ran', ''].map((h) => ({ key: h || 'more', header: h }));
const meta = {
  title: 'Components/IgnoredRow',
  component: IgnoredRow,
  parameters: { layout: 'padded' },
  decorators: [(S) => <DataTable columns={columns}><S /></DataTable>],
} satisfies Meta<typeof IgnoredRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoAccess: Story = { args: { item: ignored[0] } };
export const OnPullRequest: Story = { args: { item: ignored[1] } };
