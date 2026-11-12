import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommitSummary } from './CommitSummary';

const meta = {
  title: 'Components/CommitSummary',
  component: CommitSummary,
  args: { branch: 'main', author: 'agent-desk[bot]', message: 'Add Agent Desk skills: code-build, code-review', files: ['.claude/skills/code-build/SKILL.md', '.claude/skills/code-review/SKILL.md'] },
  decorators: [(S) => <div style={{ width: 640 }}><S /></div>],
} satisfies Meta<typeof CommitSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const OneFile: Story = { args: { files: ['.claude/skills/code-build/SKILL.md'] } };
export const Rejected: Story = {
  args: { onMessageChange: () => undefined, error: 'The commit was rejected: the branch is protected.' },
};
