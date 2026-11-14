import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConnectionIndicator } from './ConnectionIndicator';
import { TerminalBar } from './TerminalBar';

const views = [
  { id: 'term', label: 'Terminal', icon: 'terminal' as const },
  { id: 'tr', label: 'Transcript', icon: 'transcript' as const, soon: 'coming in MVP' },
];
const meta = { title: 'Components/TerminalBar', component: TerminalBar } satisfies Meta<typeof TerminalBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  args: {
    views,
    activeView: 'term',
    size: '132×44',
    connection: <ConnectionIndicator state="live" label="Live, attached as kim-hale" />,
  },
};
export const NoTerminalYet: Story = {
  args: { views, activeView: 'term', connection: <ConnectionIndicator state="none" label="No terminal yet" /> },
};
export const Ended: Story = {
  args: {
    views: [{ ...views[0], label: 'Final scrollback' }, views[1]],
    activeView: 'term',
    connection: <ConnectionIndicator state="ended" label="Ended, read-only, 1,208 lines" />,
  },
};
