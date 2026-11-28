import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ConnectionIndicator } from './ConnectionIndicator';
import { TerminalBar } from './TerminalBar';

const views = [
  { id: 'term', label: 'Terminal', icon: 'terminal' as const },
  { id: 'tr', label: 'Transcript', icon: 'transcript' as const, soon: 'coming in MVP' },
];
const meta = { title: 'Components/TerminalBar', component: TerminalBar } satisfies Meta<typeof TerminalBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  args: {
    views,
    activeView: 'term',
    size: '132×44',
    connection: <ConnectionIndicator state="live" label="Live, attached as kim-hale" />,
  },
};
export const NoTerminalYet: Story = {
  args: { views, activeView: 'term', connection: <ConnectionIndicator state="none" label="No terminal yet" /> },
};
export const Ended: Story = {
  args: {
    views: [{ ...views[0], label: 'Final scrollback' }, views[1]],
    activeView: 'term',
    connection: <ConnectionIndicator state="ended" label="Ended, read-only, 1,208 lines" />,
  },
};
const liveArgs = {
  views,
  activeView: 'term',
  size: '132×44',
  connection: <ConnectionIndicator state="live" label="Live, attached as kim-hale" />,
};
export const Copied: Story = { args: { ...liveArgs, copyStatus: 'copied' } };
export const CopyFailed: Story = { args: { ...liveArgs, copyStatus: 'failed' } };
export const TranscriptBar: Story = {
  args: {
    views: [{ id: 'transcript', label: 'Transcript', icon: 'transcript' as const }],
    activeView: 'transcript',
    tools: false,
    connection: <ConnectionIndicator state="ended" label="Paused, read-only" />,
  },
};

function TwoUsableTabsDemo() {
  const [active, setActive] = useState('term');
  return (
    <TerminalBar
      views={[
        { id: 'term', label: 'Terminal', icon: 'terminal' },
        { id: 'tr', label: 'Transcript', icon: 'transcript' },
      ]}
      activeView={active}
      onViewChange={setActive}
      connection={<ConnectionIndicator state="live" label="Live, attached as kim-hale" />}
    />
  );
}
export const TwoUsableTabs: Story = { args: liveArgs, render: () => <TwoUsableTabsDemo /> };
