import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar, CommandChip, Icon, StatusIcon } from '@/ds';
import { ChainTimeline } from './ChainTimeline';
import { EventLog } from './EventLog';
import { KeyValue } from './KeyValue';
import { Meter } from './Meter';
import { Section } from './Section';
import { SidePanel, SideRail } from './SidePanel';
import { TicketSummary } from './TicketSummary';

const meta = { title: 'Components/SidePanel', component: SidePanel } satisfies Meta<typeof SidePanel>;
export default meta;
type Story = StoryObj<typeof meta>;

const ticket = {
  kind: 'issue' as const, number: 139, title: 'Rate-limit the public webhook endpoint',
  labels: [{ name: 'user-story', color: '#7C8FD8' }, { name: 'api', color: '#52C4D9' }], state: 'Open', href: 'https://github.com/',
};

export const Running: Story = {
  args: { children: null },
  render: () => (
    <div style={{ height: 760, display: 'flex', justifyContent: 'flex-end' }}>
      <SidePanel>
        <Section title="Ticket"><TicketSummary ticket={ticket} /></Section>
        <Section title="Run">
          <KeyValue items={[
            { term: 'Skill', value: <a href="#skill" className="mono">code-build</a> },
            { term: 'Rule', value: <a href="#rule"><CommandChip>/code-build</CommandChip> on issues labelled user-story</a> },
            { term: 'Triggered by', value: <><span className="row" style={{ display: 'inline-flex', gap: 6 }}><Avatar initials="KH" size="sm" />kim-hale</span> <a href="https://github.com/" className="faint">comment</a></> },
            { term: 'Agent', value: <>Claude <span className="faint mono">opus</span></> },
            { term: 'Started', value: <span className="num">14:05:12</span> },
          ]} />
        </Section>
        <Section title="Time">
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
            <span>Elapsed <b className="num">7:40</b></span><span className="faint">limit <span className="num">30:00</span></span>
          </div>
          <Meter value={460} max={1800} aria-label="26% of run time limit used" />
        </Section>
        <Section title="Chain on this ticket" aside={<span className="faint num">max 10 runs</span>}>
          <ChainTimeline steps={[
            { runId: 61, command: '/code-build', ticket: { kind: 'issue', number: 139 }, note: 'This run', status: 'running', here: true },
            { command: '/code-review', context: 'on the PR it opens', note: 'Starts when the agent posts the command', status: 'future' },
          ]} />
        </Section>
        <Section title="Pull request"><p className="faint" style={{ fontSize: 13 }}>None yet. A link appears here when the agent opens one.</p></Section>
        <Section title="Lifecycle">
          <EventLog events={[
            { at: '14:05:10', text: 'Comment received, rule matched' }, { at: '14:05:11', text: 'Starting' },
            { at: '14:05:19', text: 'Pod running' }, { at: '14:05:27', text: 'Claude Code started' },
          ]} />
        </Section>
      </SidePanel>
    </div>
  ),
};

export const LongText: Story = {
  args: { children: null },
  render: () => (
    <div style={{ height: 300, display: 'flex', justifyContent: 'flex-end' }}>
      <SidePanel>
        <Section title="Ticket"><TicketSummary ticket={{ ...ticket, title: 'Rate-limit the public webhook endpoint and every other unauthenticated route that accepts third-party payloads from integrations' }} /></Section>
        <Section title="Run"><KeyValue items={[{ term: 'Skill', value: 'code-build-with-an-extremely-long-skill-name-that-would-overflow-the-panel' }]} /></Section>
      </SidePanel>
    </div>
  ),
};

export const Collapsed: Story = {
  args: { children: null },
  render: () => (
    <div style={{ height: 300, display: 'flex', justifyContent: 'flex-end' }}>
      <SideRail items={[
        { icon: <Icon name="issue" size={16} />, title: 'Issue #139' },
        { icon: <StatusIcon status="running" size={16} />, title: 'Running' },
        { icon: <Icon name="rule" size={16} />, title: 'Chain: 1 of 2' },
      ]} />
    </div>
  ),
};
