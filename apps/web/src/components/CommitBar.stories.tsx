import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommitBar } from './CommitBar';

const meta = {
  title: 'Components/CommitBar',
  component: CommitBar,
  args: { message: 'code-build: run dotnet format before opening the PR', branch: 'main', dirty: true, note: 'Commits as agent-desk[bot]. Runs that start after the commit use the new version; running runs keep the old one.' },
  decorators: [(S) => <div style={{ width: 900 }}><S /></div>],
} satisfies Meta<typeof CommitBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Dirty: Story = {};
export const Clean: Story = { args: { dirty: false } };
