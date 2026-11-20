import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, RouteLoadError, RouteSkeleton, type PaginationProps } from '@/components';
import {
  connectionWarnings,
  ignored,
  pagedIgnored,
  pagedNeedsYou,
  pagedRuns,
  projects,
  runDetails,
  runs,
  ticketGroups,
  tickets,
  user,
} from '@/mocks';
import type { TicketGroup } from '@/mocks/types';
import { NeedsYou as NeedsYouScreen } from './NeedsYou';
import { Runs as RunsScreen } from './Runs';
import { RunsProblems as RunsProblemsScreen, type RunsProblemsWarning } from './RunsProblems';
import type { RunsFilter } from './RunsPage';
import { viewport } from './viewports';

// Artboards come from canvas.json: Runs 1440x1000, RunsProblems 1440x960, NeedsYou 1440x740.
const meta = {
  title: 'Screens/Runs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (height: number): NonNullable<Story['decorators']> => [
  (S) => (
    <div style={{ width: 1440, height }}>
      <AppShell height={height} topBar={null}>
        <S />
      </AppShell>
    </div>
  ),
];

const project = projects[0];
const common = {
  project,
  user,
  needsYou: 1,
  slots: { used: 2, total: 2 },
  today: 'Today: 9 runs, 1 failed',
};
const counts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 6, all: 9, ignored: 3 };

export const Runs: Story = {
  name: 'Runs',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...common}
      filter="all"
      counts={counts}
      groups={ticketGroups}
      needsYouRun={{
        run: runs.find((r) => r.id === 62)!,
        askedAgo: '3 minutes ago',
        slotNote:
          'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
        href: '/runs/62',
      }}
    />
  ),
};

/** No run is idle, one is queued: the plain waiting banner, with no idle-run text or actions. */
export const RunsQueuedOnly: Story = {
  name: 'Runs, queued run waiting, none idle',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RunsScreen {...common} filter="all" counts={counts} groups={ticketGroups} waitingRun={63} />,
};

const credentialWarning: RunsProblemsWarning = {
  tone: 'warn',
  icon: 'key',
  title: 'The Claude credential was rejected',
  body: 'Run 56 failed with 401 at 11:29. New runs will fail the same way until you replace the credential.',
  actions: [{ label: 'Replace credential', href: '/desk/agent' }],
};

export const RunsProblems: Story = {
  name: 'Runs, problems and ignored commands',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: ignored.length }}
      ignored={ignored}
      warnings={[connectionWarnings.webhookSilent, credentialWarning]}
    />
  ),
};

export const RunsProblemsPolling: Story = {
  name: 'Runs, problems, polling failed',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: ignored.length }}
      ignored={ignored}
      warnings={[connectionWarnings.pollingFailed]}
    />
  ),
};

export const NeedsYou: Story = {
  name: 'Where needs you shows up',
  decorators: artboard(740),
  globals: viewport(1440, 740),
  render: () => <NeedsYouScreen project={project} projects={projects.slice(0, 3)} />,
};

export const RunsProblemsEmpty: Story = {
  name: 'Runs, problems, nothing ignored',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => <RunsProblemsScreen {...common} counts={{ ...counts, ignored: 0 }} ignored={[]} warnings={[]} />,
};

export const NeedsYouNone: Story = {
  name: 'Where needs you shows up, no idle run',
  decorators: artboard(740),
  globals: viewport(1440, 740),
  render: () => <NeedsYouScreen project={{ ...project, needsYou: 0 }} projects={projects.slice(0, 3)} runs={[]} />,
};

/** A paused run beside the idle one: the Paused badge and a Resume button. */
export const NeedsYouPaused: Story = {
  name: 'Where needs you shows up, a paused run',
  decorators: artboard(740),
  globals: viewport(1440, 740),
  render: () => (
    <NeedsYouScreen
      project={project}
      projects={projects.slice(0, 3)}
      runs={[
        {
          run: { ...runDetails.RunPaused.run },
          href: '/runs/64',
          idleAt: '14:24',
          endsAt: '14:54',
        },
        ...runs.filter((r) => r.id === 62).map((run) => ({ run, href: '/runs/62', idleAt: '14:13', endsAt: '14:43' })),
      ]}
      onResume={() => {}}
    />
  ),
};

const noop = () => undefined;
const pagination = (page: number, total: number, busy?: boolean): PaginationProps => ({
  page,
  pageSize: 20,
  total,
  ...(busy !== undefined && { busy }),
  onPageChange: noop,
  onPageSizeChange: noop,
});

/** Page 4 of 4 of 63 runs: Run 3 and 2 of a ticket whose first runs are on earlier pages, then Run 1. */
const lastPageRuns = pagedRuns(63).slice(60);
const lastPageGroups: TicketGroup[] = [
  {
    ticket: tickets.issue139,
    chainNote: 'Issue #139 → PR #140',
    runsUsed: 4,
    runsMax: 10,
    runs: lastPageRuns.slice(0, 2).map((r) => ({ ...r, ticket: tickets.issue139 })),
  },
  {
    ticket: tickets.issue131,
    runsUsed: 1,
    runsMax: 10,
    runs: lastPageRuns.slice(2).map((r) => ({ ...r, ticket: tickets.issue131 })),
  },
];
const pagedCommon = { ...common, needsYou: 1, today: 'Today: 9 runs, 1 failed' };
const pagedCounts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 59, all: 63, ignored: 3 };
const pagedNeedsYouRun = {
  run: runs.find((r) => r.id === 62)!,
  askedAgo: '3 minutes ago',
  slotNote:
    'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
  href: '/runs/62',
};

/** The last of four pages, grouped: a continued ticket header shows its full "4 of 10 runs". */
export const RunsPaged: Story = {
  name: 'Runs, grouped, page 4 of 4',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...pagedCommon}
      filter="all"
      counts={pagedCounts}
      groups={lastPageGroups}
      needsYouRun={pagedNeedsYouRun}
      pagination={pagination(4, 63)}
    />
  ),
};

const flatRuns = pagedRuns(1004).slice(1000);
/** Flat list, the last of 51 pages of 1,004 runs. */
export const RunsFlatPaged: Story = {
  name: 'Runs, flat, page 51 of 51, 1,004 runs',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...pagedCommon}
      needsYou={0}
      slots={{ used: 0, total: 2 }}
      filter="all"
      grouped={false}
      counts={{ needs_you: 0, active: 0, queued: 0, ended: 1004, all: 1004, ignored: 3 }}
      groups={flatRuns.map((r) => ({ ticket: r.ticket, runsUsed: 1, runsMax: 10, runs: [r] }))}
      pagination={pagination(51, 1004)}
    />
  ),
};

/** Page 3 is on its way: page 4 stays on screen, the table is busy and the control is disabled. */
export const RunsPageLoading: Story = {
  name: 'Runs, grouped, loading page 3 from page 4',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...pagedCommon}
      filter="all"
      counts={pagedCounts}
      groups={lastPageGroups}
      needsYouRun={pagedNeedsYouRun}
      pagination={pagination(4, 63, true)}
    />
  ),
};

/** A filter with no runs: the empty state, no control. */
export const RunsEmpty: Story = {
  name: 'Runs, empty, no runs match the filter',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...pagedCommon}
      needsYou={0}
      slots={{ used: 0, total: 2 }}
      filter="active"
      counts={{ needs_you: 0, active: 0, queued: 0, ended: 63, all: 63, ignored: 3 }}
      groups={[]}
      pagination={pagination(1, 0)}
    />
  ),
};

/** Page 2 of 2 of 27 ignored commands. */
export const RunsProblemsPaged: Story = {
  name: 'Runs, ignored commands, page 2 of 2',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: 27 }}
      ignored={pagedIgnored(27).slice(20)}
      warnings={[connectionWarnings.webhookSilent, credentialWarning]}
      pagination={pagination(2, 27)}
    />
  ),
};

/** Page 2 of 2 of 21 runs waiting for a person: the last page holds one card. */
export const NeedsYouPaged: Story = {
  name: 'Needs you, run cards, page 2 of 2',
  decorators: artboard(740),
  globals: viewport(1440, 740),
  render: () => (
    <NeedsYouScreen
      project={{ ...project, needsYou: 21 }}
      projects={projects.slice(0, 3).map((p) => (p.id === project.id ? { ...p, needsYou: 21 } : p))}
      runs={pagedNeedsYou(21).slice(20)}
      pagination={pagination(2, 21)}
    />
  ),
};

/** Any paged list on first load: the route skeleton in the Runs frame. */
export const RouteLoading: Story = {
  name: 'Any paged list, first load',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RouteSkeleton />,
};

/** Any paged list that failed to load: the route error with its request ID and Retry. */
export const RouteError: Story = {
  name: 'Any paged list, failed to load',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RouteLoadError
      title="Internal server error"
      detail="The server could not load this list."
      requestId="req_8f3a2c1d"
      onRetry={noop}
    />
  ),
};
