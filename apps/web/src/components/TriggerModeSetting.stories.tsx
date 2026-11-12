import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PollInterval, TriggerMode } from '@/mocks';
import { TriggerModeSetting } from './TriggerModeSetting';

function Demo({ mode, interval }: { mode: TriggerMode; interval: PollInterval }) {
  const [value, setValue] = useState({ mode, interval });
  return <div style={{ maxWidth: 460 }}><TriggerModeSetting {...value} onChange={setValue} /></div>;
}

const meta = {
  title: 'Components/TriggerModeSetting',
  component: TriggerModeSetting,
  parameters: { layout: 'padded' },
  render: (args) => <Demo mode={args.mode} interval={args.interval} />,
} satisfies Meta<typeof TriggerModeSetting>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Webhook: Story = { args: { mode: 'webhook', interval: '5 min' } };
export const Polling: Story = { args: { mode: 'polling', interval: '5 min' } };
export const PollingEvery15Min: Story = { args: { mode: 'polling', interval: '15 min' } };
export const WithError: Story = { args: { mode: 'webhook', interval: '5 min', error: 'Could not switch to polling. Try again.' } };
