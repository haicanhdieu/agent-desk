import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, Popover, StatusIcon } from '@/ds';
import { ConnectionIndicator } from './ConnectionIndicator';
import { EventLog } from './EventLog';
import { StartupChecklist } from './StartupChecklist';
import { Terminal, TerminalPane, TerminalPlaceholder } from './Terminal';
import { TerminalBar } from './TerminalBar';
import { shortScrollback, transcript } from './terminalFixtures';

const meta = {
  title: 'Components/Terminal',
  component: Terminal,
  decorators: [(Story) => <div style={{ height: 460, display: 'flex', flexDirection: 'column', background: 'var(--term)' }}><Story /></div>],
} satisfies Meta<typeof Terminal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ClaudeCodeTranscript: Story = { args: { lines: transcript } };
export const WithCursor: Story = { args: { lines: transcript, cursor: true } };
export const TopAnchoredShortScrollback: Story = { args: { lines: shortScrollback, anchor: 'top' } };
export const Empty: Story = { args: { lines: [] } };

const views = [
  { id: 'term', label: 'Terminal', icon: 'terminal' as const },
  { id: 'tr', label: 'Transcript', icon: 'transcript' as const, soon: 'coming in MVP' },
];

export const ReconnectingDimmedWithOverlay: Story = {
  args: { lines: transcript, dimmed: true },
  render: (args) => (
    <TerminalPane
      bar={<TerminalBar views={views} activeView="term" size="116×38" connection={<ConnectionIndicator state="reconnecting" label="Reconnecting, attempt 3" />} />}
      overlay={
        <Popover open role="status" label="Connection to the terminal lost" width={460} style={{ left: '50%', top: '30%', transform: 'translateX(-50%)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><StatusIcon status="starting" size={18} /><b>Connection to the terminal lost</b></div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>The agent keeps working; tmux holds the session. Retrying in 4 s.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" icon="refresh">Reconnect now</Button></div>
        </Popover>
      }
    >
      <Terminal {...args} />
    </TerminalPane>
  ),
};

export const PlaceholderStarting: Story = {
  args: { lines: [] },
  render: () => (
    <TerminalPane bar={<TerminalBar views={views} activeView="term" connection={<ConnectionIndicator state="none" label="No terminal yet" />} />}>
      <TerminalPlaceholder title="Starting the agent" body="The terminal opens here by itself when Claude Code is ready, usually within a minute.">
        <StartupChecklist steps={[
          { label: 'Queued', detail: 'Waited 3m 10s for a free slot', at: '14:12:03', state: 'done' },
          { label: 'Starting the pod', state: 'active' },
          { label: 'Open the terminal', state: 'pending' },
        ]} />
      </TerminalPlaceholder>
    </TerminalPane>
  ),
};

export const PlaceholderNoScrollback: Story = {
  args: { lines: [] },
  render: () => (
    <TerminalPane bar={<TerminalBar views={[{ ...views[0], label: 'Final scrollback' }, views[1]]} activeView="term" connection={<ConnectionIndicator state="ended" label="Ended" />} />}>
      <TerminalPlaceholder title="No scrollback was saved" body="The pod stopped before the terminal could be captured.">
        <EventLog events={[{ at: '13:02:55', text: 'Comment received, rule matched' }, { at: '13:10:45', text: 'Pod removed, run cancelled' }]} timeWidth={70} />
        <div><Button icon="branch" href="https://github.com/">Branch ad/120-dark-mode on GitHub</Button></div>
      </TerminalPlaceholder>
    </TerminalPane>
  ),
};
