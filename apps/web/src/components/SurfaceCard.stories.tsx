import type { Meta, StoryObj } from '@storybook/react-vite';
import { SurfaceCard } from './SurfaceCard';

const meta = { title: 'Components/SurfaceCard', component: SurfaceCard, decorators: [(S) => <div style={{ width: 480 }}><S /></div>] } satisfies Meta<typeof SurfaceCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    caption: 'Browser tab: title prefix with the count of runs that need you, and an amber dot on the favicon.',
    children: <div style={{ padding: 16, background: 'var(--chrome-bg)', color: 'var(--text)' }}>(1) Runs, Agent Desk</div>,
  },
};
