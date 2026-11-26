import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { DeleteAgentDialog } from './DeleteAgentDialog';

const meta = {
  title: 'Components/DeleteAgentDialog',
  component: DeleteAgentDialog,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', minHeight: 420 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof DeleteAgentDialog>;
export default meta;
type Story = StoryObj<typeof DeleteAgentDialog>;

const base = { name: 'Claude - Work', onKeep: fn(), onDelete: fn() };

export const Confirm: Story = { args: { ...base, state: 'confirm' } };
export const Deleting: Story = { args: { ...base, state: 'deleting' } };
export const BlockedByRule: Story = { args: { ...base, state: 'blockedRules', rule: { count: 1, command: 'fix' } } };
export const BlockedByOpenRun: Story = {
  args: {
    ...base,
    state: 'blocked',
    reason: {
      title: 'This agent has open runs',
      text: 'Run 12 is paused and can be resumed. Finish it first, then delete.',
    },
  },
};
export const ServerError: Story = {
  args: { ...base, state: 'error', error: { title: 'Something went wrong', requestId: 'req_8f3a21' } },
};
export const HostileName: Story = { args: { ...base, state: 'confirm', name: '<b>x</b><img src=x onerror=alert(1)>' } };
