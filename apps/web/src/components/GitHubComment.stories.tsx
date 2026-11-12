import type { Meta, StoryObj } from '@storybook/react-vite';
import { GitHubComment } from './GitHubComment';

const meta = {
  title: 'Components/GitHubComment',
  component: GitHubComment,
  decorators: [(S) => <div style={{ width: 560, border: '1px solid var(--line2)', borderRadius: 10, overflow: 'hidden' }}><S /></div>],
} satisfies Meta<typeof GitHubComment>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Bot: Story = {
  args: {
    author: 'agent-desk[bot]', bot: true, meta: 'commented on PR #148, edited 14:13',
    children: <span><b>Run 62</b> <span className="mono">code-review</span> is waiting for your input.</span>,
  },
};
