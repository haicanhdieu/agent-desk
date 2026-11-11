import type { Meta, StoryObj } from '@storybook/react-vite';
import { projects } from '@/mocks';
import { DataTable } from './DataTable';
import { ProjectRow } from './ProjectRow';

const columns = ['Project', 'GitHub', 'Needs you', 'Running', 'Queued', 'Last run', ''].map((h) => ({ key: h || 'more', header: h || <span className="sr-only">Actions</span> }));
const meta = {
  title: 'Components/ProjectRow',
  component: ProjectRow,
  parameters: { layout: 'padded' },
  decorators: [(S) => <DataTable columns={columns}><S /></DataTable>],
} satisfies Meta<typeof ProjectRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsYou: Story = { args: { project: projects[0], href: '#' } };
export const Quiet: Story = { args: { project: projects[1], href: '#' } };
export const WebhookWarning: Story = { args: { project: projects[2], href: '#' } };
export const LongRepo: Story = { args: { project: { ...projects[1], repo: `harbor-labs/${'very-long-'.repeat(8)}` }, href: '#' } };
