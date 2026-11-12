import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventLog } from './EventLog';

const meta = { title: 'Components/EventLog', component: EventLog } satisfies Meta<typeof EventLog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Lifecycle: Story = {
  args: {
    events: [
      { at: '13:02:55', text: 'Comment received, rule matched' },
      { at: '13:02:56', text: 'Starting' },
      { at: '13:03:06', text: 'Running' },
      { at: '13:10:41', text: 'Cancel requested by kim-hale' },
      { at: '13:10:45', text: 'Pod removed, run cancelled' },
    ],
    timeWidth: 70,
  },
};
export const NoEvents: Story = { args: { events: [] } };
