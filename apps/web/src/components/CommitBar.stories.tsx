import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommitBar } from './CommitBar';

const meta = {
  title: 'Components/CommitBar',
  component: CommitBar,
  args: {
    message: 'code-build: run dotnet format before opening the PR',
    branch: 'main',
    dirty: true,
    note: 'Submitted as agent-desk[bot]. If the target branch requires review, the changes are submitted for review instead of saved.',
  },
  decorators: [
    (S) => (
      <div style={{ width: 900 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof CommitBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Dirty: Story = {};
export const Clean: Story = { args: { dirty: false } };
export const Committing: Story = { args: { pending: true } };
export const UnknownBranch: Story = { args: { branch: null } };
