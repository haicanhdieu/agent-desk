import type { Meta, StoryObj } from '@storybook/react-vite';
import { Icon } from './Icon';
import { InlineStatus } from './InlineStatus';
import { page } from './foundations.shared';

function Gallery() {
  return (
    <div style={page}>
      <h1>InlineStatus</h1>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <InlineStatus tone="ok" icon={<Icon name="check" />}>Connected</InlineStatus>
        <InlineStatus tone="ok" icon={<Icon name="check" />}>Installed on harbor-labs</InlineStatus>
        <InlineStatus tone="warn" icon={<Icon name="warning" />}>No webhooks for 2 days</InlineStatus>
        <InlineStatus tone="err" icon={<Icon name="x" />}>Rejected at 11:29</InlineStatus>
        <InlineStatus tone="idle" icon={<Icon name="pause" />}>Timer paused</InlineStatus>
        <InlineStatus tone="off" icon={<Icon name="clock" />}>Waiting</InlineStatus>
      </section>
    </div>
  );
}

const meta = { title: 'Primitives/InlineStatus', component: Gallery } satisfies Meta<typeof Gallery>;
export default meta;
export const All: StoryObj<typeof meta> = {};
