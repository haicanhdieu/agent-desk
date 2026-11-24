import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment } from 'react';
import { Button, PR_STATES, RUN_STATUSES } from '@/ds';
import { prStateRuns } from '@/mocks';
import { usageCellNoCost, usageCellNone, usageCellPartial, usageCellSubCent, usageCellValue } from '@/mocks/usage';
import type { RunSummary, TicketGroup, Ticket } from '@/mocks/types';
import { DataTable } from './DataTable';
import { RunRow, TicketGroupRow } from './RunRow';

const ticket: Ticket = {
  kind: 'issue',
  number: 142,
  title: 'Export invoices as CSV from the billing page',
  labels: [{ name: 'user-story', color: 'var(--label-story)' }],
  href: 'https://github.com/',
};
const kim = { login: 'kim-hale', initials: 'KH' };
const bot = { login: 'agent-desk[bot]', bot: true };
const base: RunSummary = {
  id: 60,
  status: 'succeeded',
  command: '/build',
  skill: 'code-build',
  agent: 'claude',
  model: 'opus',
  ticket,
  triggeredBy: kim,
  startedAt: '14:02',
  duration: '6m 12s',
};
const notes: Partial<Record<string, string>> = {
  idle: 'Waiting 3m. Auto-finish after 10m unattended',
  failed: 'API authentication failed (401)',
  cancelled: 'Cancelled by kim-hale',
  queued: 'Next in line. 2 of 2 slots busy (1 needs you)',
};
const columns = [
  { key: 'run', header: 'Run' },
  { key: 'status', header: 'Status' },
  { key: 'ticket', header: 'Ticket' },
  { key: 'rule', header: 'Routing rule' },
  { key: 'by', header: 'Triggered by' },
  { key: 'started', header: 'Started' },
  { key: 'dur', header: 'Duration' },
  { key: 'usage', header: 'Usage' },
  {
    key: 'actions',
    header: (
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Actions
      </span>
    ),
  },
];
const pr148: Ticket = { ...ticket, kind: 'pr', number: 148, title: 'Add CSV export to billing', labels: [] };
const group = (t: Ticket = ticket): TicketGroup => ({
  ticket: t,
  chainNote: 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)',
  runsUsed: 1,
  runsMax: 10,
  linked: [{ ticket: { kind: 'pr', number: 148 }, runsUsed: 1 }],
  runs: [],
});

const meta = {
  title: 'Components/RunRow',
  component: RunRow,
  decorators: [
    (Story) => (
      <DataTable columns={columns}>
        <Story />
      </DataTable>
    ),
  ],
} satisfies Meta<typeof RunRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Succeeded: Story = { args: { run: base, tree: 'last', href: '#' } };

export const LongRoutingRule: Story = {
  args: {
    run: { ...base, command: '/code-build-and-review-with-a-very-long-routing-rule-command' },
    tree: 'last',
    href: '#',
  },
};

export const NoRoutingRule: Story = { args: { run: { ...base, command: '' }, tree: 'last', href: '#' } };

export const EveryStatus: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      {RUN_STATUSES.map((s, i) => (
        <RunRow
          key={s}
          run={{
            ...base,
            id: 50 + i,
            status: s,
            statusNote: notes[s],
            duration: s === 'queued' ? undefined : base.duration,
          }}
          tree={i === RUN_STATUSES.length - 1 ? 'last' : 'mid'}
          href="#"
        />
      ))}
    </>
  ),
};

export const IdleWithActions: Story = {
  args: {
    run: {
      ...base,
      id: 62,
      status: 'idle',
      statusNote: notes.idle,
      triggeredBy: bot,
      ticket: { ...ticket, kind: 'pr', number: 148 },
    },
    tree: 'last',
    href: '#',
    actions: (
      <>
        <Button variant="go" size="sm" href="#">
          Open terminal
        </Button>{' '}
        <Button size="sm">Finish</Button>
      </>
    ),
  },
};

export const Running: Story = {
  args: {
    run: { ...base, id: 61, status: 'running' },
    tree: 'last',
    href: '#',
    actions: (
      <Button size="sm" href="#">
        Watch
      </Button>
    ),
  },
};

export const Connectors: Story = {
  args: { run: base, tree: 'mid', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={9} />
      <RunRow run={base} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 61, status: 'failed', statusNote: notes.failed }} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 62, ticket: pr148 }} tree="last" href="#" />
    </>
  ),
};

/** Ungrouped list: no ticket header, so no tree connector. */
export const Ungrouped: Story = {
  args: { run: base, tree: 'none', href: '#' },
  render: () => (
    <>
      <RunRow run={base} tree="none" href="#" />
      <RunRow run={{ ...base, id: 61, status: 'failed', statusNote: notes.failed }} tree="none" href="#" />
    </>
  ),
};

/** Ungrouped list: a ticket title longer than the column is cut with an ellipsis (full title in the tooltip). */
export const UngroupedLongTitle: Story = {
  args: { run: base, tree: 'none', href: '#' },
  render: () => (
    <RunRow
      run={{
        ...base,
        ticket: {
          ...ticket,
          title:
            'Export invoices as CSV from the billing page including every historical adjustment, credit note and proration',
        },
      }}
      tree="none"
      href="#"
    />
  ),
};

export const GroupHeader: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => <TicketGroupRow group={group()} colSpan={9} />,
};

export const LongTitle: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <TicketGroupRow
      group={group({
        ...ticket,
        title:
          'Export invoices as CSV from the billing page including every historical adjustment, credit note, proration, tax rounding rule and regional variant we have ever shipped'.repeat(
            2,
          ),
      })}
      colSpan={9}
    />
  ),
};

/** The ticket number links to GitHub in a new window; an empty href (untrusted URL dropped) is plain text. */
export const TicketLinks: Story = {
  args: { run: base, tree: 'mid', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={9} />
      <RunRow run={base} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 61, ticket: { ...ticket, kind: 'pr', number: 148 } }} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 62, ticket: { ...ticket, href: '' } }} tree="last" href="#" />
      <TicketGroupRow group={group({ ...ticket, href: '' })} colSpan={9} />
    </>
  ),
};

const prGroup = (t: Ticket, runsUsed: number): TicketGroup => ({ ticket: t, runsUsed, runsMax: 10, runs: [] });

/** Issue-led header: the chain note carries each ticket's own count and nothing sits on the right. */
export const GroupHeaderIssueAndPr: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={9} />
      <RunRow run={base} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 62, ticket: pr148 }} tree="last" href="#" />
    </>
  ),
};

export const GroupHeaderSeveralPrs: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      <TicketGroupRow
        group={{
          ...group(),
          chainNote: 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs)',
          linked: [
            { ticket: { kind: 'pr', number: 148 }, runsUsed: 1 },
            { ticket: { kind: 'pr', number: 150 }, runsUsed: 2 },
          ],
        }}
        colSpan={9}
      />
      <RunRow run={base} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 62, ticket: pr148 }} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 63, ticket: { ...pr148, number: 150 } }} tree="last" href="#" />
    </>
  ),
};

/** A narrow artboard: the title ellipsises first, then the chain note. The full note is its tooltip. */
export const GroupHeaderLongChain: Story = {
  args: { run: base, tree: 'last', href: '#' },
  decorators: [
    (Story) => (
      <div style={{ width: 720 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <TicketGroupRow
      group={{
        ...group({
          ...ticket,
          title: 'Export invoices as CSV from the billing page including every historical adjustment and credit note',
        }),
        chainNote:
          'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs), PR #150 (2 of 10 runs), PR #153 (1 of 10 runs), PR #157 (3 of 10 runs), PR #160 (1 of 10 runs), PR #164 (2 of 10 runs)',
        linked: [148, 150, 153, 157, 160, 164].map((number) => ({
          ticket: { kind: 'pr' as const, number },
          runsUsed: 1,
        })),
      }}
      colSpan={9}
    />
  ),
};

/** A PR run that arrived after the link was lost sits in the merged group; PR #148's own group keeps the older run. */
export const GroupHeaderSplitPr: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={9} />
      <RunRow run={{ ...base, id: 64, ticket: pr148 }} tree="last" href="#" />
      <TicketGroupRow group={prGroup(pr148, 2)} colSpan={9} />
      <RunRow run={{ ...base, id: 50, ticket: pr148 }} tree="last" href="#" />
    </>
  ),
};

/** The issue leads the header although only PR runs are on this page. */
export const GroupHeaderPrRunsOnly: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      <TicketGroupRow group={group()} colSpan={9} />
      <RunRow run={{ ...base, id: 62, ticket: pr148 }} tree="mid" href="#" />
      <RunRow run={{ ...base, id: 63, ticket: pr148 }} tree="last" href="#" />
    </>
  ),
};

/** Flat rows: each live PR state, then PR #174 whose state is unknown (neutral). */
export const PrStates: Story = {
  args: { run: base, tree: 'none', href: '#' },
  render: () => (
    <>
      {prStateRuns.map((r) => (
        <RunRow key={r.id} run={r} tree="none" href="#" />
      ))}
    </>
  ),
};

/** PR-led group headers, one per state, each over its run. */
export const GroupHeaderPrStates: Story = {
  args: { run: base, tree: 'last', href: '#' },
  render: () => (
    <>
      {PR_STATES.map((s, i) => {
        const r = prStateRuns[i];
        return (
          <Fragment key={s}>
            <TicketGroupRow group={{ ticket: r.ticket, runsUsed: 1, runsMax: 10, runs: [r] }} colSpan={9} />
            <RunRow run={r} tree="last" href="#" />
          </Fragment>
        );
      })}
    </>
  ),
};

/** Usage column: value, partial, no cost, below a cent, none, absent. */
export const Usage: Story = {
  args: { run: { ...base, usage: usageCellValue }, tree: 'none', href: '#' },
  render: () => (
    <>
      <RunRow run={{ ...base, usage: usageCellValue }} tree="none" href="#" />
      <RunRow run={{ ...base, id: 61, usage: usageCellPartial }} tree="none" href="#" />
      <RunRow run={{ ...base, id: 62, usage: usageCellNoCost }} tree="none" href="#" />
      <RunRow run={{ ...base, id: 63, usage: usageCellSubCent }} tree="none" href="#" />
      <RunRow run={{ ...base, id: 64, usage: usageCellNone }} tree="none" href="#" />
      <RunRow run={{ ...base, id: 65 }} tree="none" href="#" />
    </>
  ),
};
