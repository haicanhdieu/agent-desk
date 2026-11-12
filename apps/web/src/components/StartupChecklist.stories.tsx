import type { Meta, StoryObj } from '@storybook/react-vite';
import { StartupChecklist } from './StartupChecklist';

const meta = { title: 'Components/StartupChecklist', component: StartupChecklist } satisfies Meta<typeof StartupChecklist>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  args: {
    steps: [
      { label: 'Queued', detail: 'Waited 3m 10s for a free slot', at: '14:12:03', state: 'done' },
      { label: 'Slot claimed, token and secret created', at: '14:15:13', state: 'done' },
      { label: 'Waiting for Claude Code to start', state: 'active' },
      { label: 'Open the terminal', state: 'pending' },
    ],
  },
};
