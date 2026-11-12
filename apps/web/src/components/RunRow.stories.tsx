import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, RUN_STATUSES } from '@/ds';
import type { RunSummary, TicketGroup, Ticket } from '@/mocks/types';
import { DataTable } from './DataTable';
import { RunRow, TicketGroupRow } from './RunRow';

const ticket: Ticket = {
  kind: 'issue', number: 142, title: 'Export invoices as CSV from the billing page',
  labels: [{ name: 'user-story', color: 'var(--label-story)' }], href: 'https://github.com/',
};
const kim = { login: 'kim-hale', initials: 'KH' };
const bot = { login: 'agent-desk[bot]', bot: true };
const base: RunSummary = {
  id: 60, status: 'succeeded', command: '/build', skill: 'code-build', agent: 'claude', model: 'opus',
  ticket, triggeredBy: kim, startedAt: '14:02', duration: '6m 12s',
};
const notes: Partial<Record<string, string>> = {
  idle: 'Waiting 3m. Auto-finish after 10m unattended', failed: 'API authentication failed (401)',
  cancelled: 'Cancelled by kim-hale', queued: 'Next in line. 2 of 2 slots busy (1 needs you)',
};
const columns = [
  { key: 'run', header: 'Run' }, { key: 'status', header: 'Status' }, { key: 'ticket', header: 'Ticket' },
  { key: 'skill', header: 'Skill' }, { key: 'by', header: 'Triggered by' }, { key: 'started', header: 'Started' },
  { key: 'dur', header: 'Duration' }, { key: 'actions', header: <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span> },
];
const group = (t: Ticket = ticket): TicketGroup => ({ ticket: t, chainNote: 'Issue #142 → PR #148', runsUsed: 2, runsMax: 10, runs: [] });

const meta = {
  title: 'Components/RunRow',
  component: RunRow,
  decorators: [(Story) => <DataTable columns={columns}><Story /></DataTable>],
} satisfies Meta<typeof RunRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Succeeded: Story = { args: { run: base, tree: 'last', href: '#' } };

export const EveryStatus: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      {RUN_STATUSES.map((s, i) => (
        <RunRow
          key={s}
          run={{ ...base, id: 50 + i, status: s, statusNote: notes[s], duration: s === 'queued' ? undefined : base.duration }}
          tree={i === RUN_STATUSES.length - 1 ? 'last' : 'mid'}
          href="#"
        />
      ))}
    </>
  ),
};

export const IdleWithActions: Story = {
  args: {
    run: { ...base, id: 62, status: 'idle', statusNote: notes.idle, triggeredBy: bot, ticket: { ...ticket, kind: 'pr', number: 148 } },
    tree: 'last',
    href: '#',
    actions: (<><Button variant="go" size="sm" href="#">Open terminal</Button> <Button size="sm">Finish</Button></>),
  },
};

export const Running: Story = {
  args: { run: { ...base, id: 61, status: 'running' }, tree: 'last', href: '#', actions: <Button size="sm" href="#">Watch</Button> },
};

export const Connectors: Story = {
  args: { run: base, tree: 'mid', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={8} />
      <RunRow run={base} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 61, status: 'failed', statusNote: notes.failed }} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 62 }} tree="last" href="#" />
    </>
  ),
};

export const GroupHeader: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => <TicketGroupRow group={group()} colSpan={8} />,
};

export const LongTitle: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <TicketGroupRow
      group={group({ ...ticket, title: 'Export invoices as CSV from the billing page including every historical adjustment, credit note, proration, tax rounding rule and regional variant we have ever shipped'.repeat(2) })}
      colSpan={8}
    />
  ),
};
