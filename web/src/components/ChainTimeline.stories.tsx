import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChainTimeline } from './ChainTimeline';

const meta = {
  title: 'Components/ChainTimeline', component: ChainTimeline,
  decorators: [(S) => <div style={{ width: 312 }}><S /></div>],
} satisfies Meta<typeof ChainTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;

const issue = { kind: 'issue' as const, number: 139 };

export const RunningWithFuture: Story = {
  args: { steps: [
    { runId: 61, command: '/code-build', ticket: issue, note: 'This run', status: 'running', here: true },
    { command: '/code-review', context: 'on the PR it opens', note: 'Starts when the agent posts the command', status: 'future' },
  ] },
};
export const IdleMidChain: Story = {
  args: { steps: [
    { runId: 60, command: '/code-build', ticket: issue, note: 'Succeeded in 6m 12s, opened PR #148', status: 'succeeded', href: '#run-60' },
    { runId: 61, command: '/code-review', ticket: { kind: 'pr', number: 148 }, note: 'This run, waiting for you', status: 'idle', here: true },
    { command: '/code-fix', context: 'on the PR', note: 'Starts when the agent posts the command', status: 'future' },
  ] },
};
export const FailedWithReissue: Story = {
  args: { steps: [
    { runId: 61, command: '/code-build', ticket: issue, note: 'This run, failed after 3m 02s', status: 'failed', here: true },
    { runId: 62, command: '/code-build', ticket: issue, note: 'Re-issued by kim-hale', status: 'running', href: '#run-62' },
  ] },
};
export const Empty: Story = { args: { steps: [] } };
