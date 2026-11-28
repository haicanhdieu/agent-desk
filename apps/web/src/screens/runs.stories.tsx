import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { userEvent, waitFor, within } from 'storybook/test';
import { EmptyState, RouteLoadError, RouteSkeleton, type PaginationProps } from '@/components';
import {
  connectionWarnings,
  ignored,
  ignoredPrStates,
  linkedGroups,
  pagedIgnored,
  pagedRuns,
  projectSwitchFixtures,
  prStateRuns,
  runs,
  ticketGroups,
  tickets,
  usageCellPage2,
  usageCellPage3,
} from '@/mocks';
import type { TicketGroup } from '@/mocks/types';
import { Runs as RunsScreen } from './Runs';
import { RunsProblems as RunsProblemsScreen, type RunsProblemsWarning } from './RunsProblems';
import { RunsPage, type RunsFilter } from './RunsPage';
import { OrgShellFrame } from './orgShellFrame';
import { ProjectShellFrame, type ProjectShellFrameProps } from './projectShellFrame';
import { Button } from '@/ds';
import styles from './Screens.module.css';
import { viewport } from './viewports';

// Artboards come from canvas.json: Runs 1440x1000, RunsProblems 1440x960.
const meta = {
  title: 'Screens/Runs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (height: number): NonNullable<Story['decorators']> => [
  (S) => (
    <div style={{ width: 1440, height }}>
      <ProjectShellFrame page="runs" height={height} crumbs={[{ label: 'Runs' }]}>
        <S />
      </ProjectShellFrame>
    </div>
  ),
];

const common = {
  slots: { used: 2, total: 2 },
  today: 'Today: 9 runs, 1 failed',
};
const search = { value: '', applied: '', onChange: () => undefined };
const counts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 6, all: 9, ignored: 3 };

export const Runs: Story = {
  name: 'Runs',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
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
      onFinishIdle={() => undefined}
    />
  ),
};

/** No run is idle, one is queued: the plain waiting banner, with no idle-run text or actions. */
export const RunsQueuedOnly: Story = {
  name: 'Runs, queued run waiting, none idle',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen search={search} {...common} filter="all" counts={counts} groups={ticketGroups} waitingRun={63} />
  ),
};

/** A search that matches nothing: the query in the title and a Clear search action. */
export const RunsSearchEmpty: Story = {
  name: 'Runs, search with no results',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...common}
      filter="all"
      counts={counts}
      groups={[]}
      search={{ value: 'zebra', applied: 'zebra', onChange: () => undefined }}
    />
  ),
};

/** The next results are loading: the box keeps the typed text and stays editable, the results are busy. */
export const RunsSearchLoading: Story = {
  name: 'Runs, search loading',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...common}
      filter="all"
      counts={counts}
      groups={ticketGroups}
      search={{ value: 'fix', applied: '', onChange: () => undefined }}
      pagination={{
        page: 1,
        pageSize: 20,
        total: 9,
        busy: true,
        onPageChange: () => undefined,
        onPageSizeChange: () => undefined,
      }}
    />
  ),
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

export const RunsProblemsEmpty: Story = {
  name: 'Runs, problems, nothing ignored',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => <RunsProblemsScreen {...common} counts={{ ...counts, ignored: 0 }} ignored={[]} warnings={[]} />,
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
const lastPageRuns = pagedRuns(63)
  .slice(60)
  .map((r) => ({ ...r, usage: r.id === 3 ? usageCellPage3 : r.id === 2 ? usageCellPage2 : undefined }));
const lastPageGroups: TicketGroup[] = [
  {
    ticket: tickets.issue139,
    chainNote: 'Issue #139 (2 of 10 runs) → PR #140 (2 of 10 runs)',
    runsUsed: 2,
    runsMax: 10,
    linked: [{ ticket: { kind: 'pr', number: 140 }, runsUsed: 2 }],
    runs: lastPageRuns.slice(0, 2).map((r) => ({ ...r, ticket: tickets.issue139 })),
  },
  {
    ticket: tickets.issue131,
    runsUsed: 1,
    runsMax: 10,
    runs: lastPageRuns.slice(2).map((r) => ({ ...r, ticket: tickets.issue131 })),
  },
];
const pagedCommon = { ...common, today: 'Today: 9 runs, 1 failed' };
const pagedCounts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 59, all: 63, ignored: 3 };
const pagedNeedsYouRun = {
  run: runs.find((r) => r.id === 62)!,
  askedAgo: '3 minutes ago',
  slotNote:
    'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
  href: '/runs/62',
};

/** The last of four pages, grouped: a merged header shows each ticket's own count in its chain note. */
export const RunsPaged: Story = {
  name: 'Runs, grouped, page 4 of 4',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
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
      search={search}
      {...pagedCommon}
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
      search={search}
      {...pagedCommon}
      filter="all"
      counts={pagedCounts}
      groups={lastPageGroups}
      needsYouRun={pagedNeedsYouRun}
      pagination={pagination(4, 63, true)}
    />
  ),
};

const linkedRun62Note = 'Waiting 3m. Auto-finish after 10m unattended';
// The linked boards say the idle run ends after 10 minutes, as their prototype boards do.
const linkedNeedsYouRun = {
  ...pagedNeedsYouRun,
  run: { ...pagedNeedsYouRun.run, statusNote: linkedRun62Note },
  slotNote:
    'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 10 minutes with nobody attached.',
};
// Run 62's own row says 10m as well, as in RunsLinked.dc.html; the shared ticketGroups keep 30m for Runs.
const linkedTicketGroups: TicketGroup[] = ticketGroups.map((g) => ({
  ...g,
  runs: g.runs.map((r) => (r.id === 62 ? { ...r, statusNote: linkedRun62Note } : r)),
}));
const linkedCounts: Record<RunsFilter, number> = { ...counts };
const linkedCommon = { ...common, filter: 'all' as RunsFilter, counts: linkedCounts, needsYouRun: linkedNeedsYouRun };

/** An issue and the PR linked to it in one group, each ticket's own run count in the chain note. */
export const RunsLinked: Story = {
  name: 'Runs, grouped, issue with its PR',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RunsScreen search={search} {...linkedCommon} groups={linkedTicketGroups} />,
};

/** One issue with two PRs: PRs in number order, run limit counted per ticket. */
export const RunsLinkedSeveralPrs: Story = {
  name: 'Runs, grouped, issue with several PRs',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...linkedCommon}
      today="Today: 10 runs, 1 failed"
      counts={{ ...linkedCounts, ended: 7, all: 10 }}
      groups={linkedGroups.severalPrs}
    />
  ),
};

/** Older runs of PR #148 predate the link: they stay in the PR's own group below. */
export const RunsLinkedSplitPr: Story = {
  name: 'Runs, grouped, one PR in two groups (older runs unlinked)',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RunsScreen search={search} {...linkedCommon} groups={linkedGroups.splitPr} />,
};

/** The Needs you filter keeps run 62 under the merged header with its full chain note. */
export const RunsLinkedFiltered: Story = {
  name: 'Runs, grouped, Needs you filter on a merged group',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RunsScreen search={search} {...linkedCommon} filter="needs_you" groups={linkedGroups.filtered} />,
};

/** Six PRs: the title and then the chain note are cut off with an ellipsis; both carry a title tooltip. */
export const RunsLinkedLongChain: Story = {
  name: 'Runs, grouped, long chain note cut off',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => <RunsScreen search={search} {...linkedCommon} groups={linkedGroups.longChain} />,
};

const linkedPagedCommon = {
  ...pagedCommon,
  filter: 'all' as RunsFilter,
  counts: pagedCounts,
  needsYouRun: linkedNeedsYouRun,
};

/** Page 4 of 4: only the PR's runs of a merged group are on this page. */
export const RunsPagedLinkedPrOnly: Story = {
  name: 'Runs, grouped, page 4 of 4, only the PR runs of a merged group',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...linkedPagedCommon}
      groups={linkedGroups.pagedPrOnly}
      pagination={pagination(4, 63)}
    />
  ),
};

/** Page 4 of 4: only the issue's runs of a merged group are on this page. */
export const RunsPagedLinkedIssueOnly: Story = {
  name: 'Runs, grouped, page 4 of 4, only the issue runs of a merged group',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...linkedPagedCommon}
      groups={linkedGroups.pagedIssueOnly}
      pagination={pagination(4, 63)}
    />
  ),
};

/** Page 3 is on its way: the merged page 4 stays on screen, busy, with the control disabled. */
export const RunsPageLoadingLinked: Story = {
  name: 'Runs, grouped, loading page 3 from a merged page 4',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...linkedPagedCommon}
      groups={linkedGroups.pageLoading}
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
      search={search}
      {...pagedCommon}
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

/** Every PR icon takes its live state colour; the merged group's issue header stays plain. */
export const RunsPrStates: Story = {
  name: 'Runs, PR states',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...common}
      filter="all"
      counts={counts}
      groups={[
        ticketGroups[0],
        ...prStateRuns.map((r): TicketGroup => ({ ticket: r.ticket, runsUsed: 1, runsMax: 10, runs: [r] })),
      ]}
    />
  ),
};

export const RunsProblemsPrStates: Story = {
  name: 'Runs, problems, ignored PR states',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: ignoredPrStates.length }}
      ignored={ignoredPrStates}
      warnings={[]}
    />
  ),
};

// The usage boards say the idle run ends after 10 minutes, as the linked boards do.
const usageNeedsYouRun = linkedNeedsYouRun;
const usageRunsGroups: TicketGroup[] = ticketGroups.map((g) => ({
  ...g,
  runs: g.runs.map((r) => (r.id === 62 ? { ...r, statusNote: linkedRun62Note } : r)),
}));

/** The Runs list with the Usage column: a value, a partial cost, a missing cost, below a cent, none. */
export const RunsUsage: Story = {
  name: 'Runs, usage column',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...common}
      filter="all"
      counts={counts}
      groups={usageRunsGroups}
      needsYouRun={usageNeedsYouRun}
    />
  ),
};

/** Page 3 is loading from page 4: the table is busy and keeps the Usage column. */
export const RunsPageLoadingUsage: Story = {
  name: 'Runs, grouped, loading page 3 from page 4, usage column',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      search={search}
      {...pagedCommon}
      filter="all"
      counts={pagedCounts}
      groups={lastPageGroups}
      needsYouRun={usageNeedsYouRun}
      pagination={pagination(4, 63, true)}
    />
  ),
};

// The same page inside the shell: the project menu with its repository block beside a page that draws only its header,
// the chips and the list.
const runsCrumbs = [{ label: 'Runs' }];
const idleRun = {
  run: runs.find((r) => r.id === 62)!,
  askedAgo: '3 minutes ago',
  slotNote:
    'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
  href: '/runs/62',
};
const shellRuns = (frame: Partial<ProjectShellFrameProps> = {}, body?: ReactNode) => (
  <ProjectShellFrame page="runs" crumbs={runsCrumbs} {...frame}>
    {body ?? (
      <RunsScreen
        search={search}
        {...common}
        filter="all"
        counts={counts}
        groups={ticketGroups}
        needsYouRun={idleRun}
        onFinishIdle={() => undefined}
      />
    )}
  </ProjectShellFrame>
);
const shellPage = (children: ReactNode) => (
  <RunsPage {...common} filter="all" counts={counts} search={search}>
    {children}
  </RunsPage>
);
const openSwitcher: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch project/ }));
  await waitFor(() => within(canvasElement).getByRole('dialog', { name: 'Switch project' }));
};

export const RunsSideMenu: Story = {
  name: 'Runs, full project menu',
  globals: viewport(1440, 900),
  render: () => shellRuns(),
};
export const RunsSideMenuMember: Story = {
  name: 'Runs, project menu for a member or viewer',
  globals: viewport(1440, 900),
  render: () => shellRuns({ menu: 'member' }),
};
export const RunsSideMenuLoading: Story = {
  name: 'Runs, project menu loading',
  globals: viewport(1440, 900),
  render: () => shellRuns({ menu: 'loading' }, shellPage(<RouteSkeleton />)),
};
export const RunsSideMenuError: Story = {
  name: 'Runs, project menu and list failed to load',
  globals: viewport(1440, 900),
  render: () =>
    shellRuns(
      { menu: 'error' },
      shellPage(
        <RouteLoadError title="Internal server error" requestId="req_01JD7Q3M8V2K" onRetry={() => undefined} />,
      ),
    ),
};
export const RunsSideMenuRepoWarning: Story = {
  name: 'Runs, repository block with a webhook warning',
  globals: viewport(1440, 900),
  render: () => shellRuns({ menu: 'repoWarning' }),
};
export const RunsSideMenuRepoError: Story = {
  name: 'Runs, repository block with a polling error',
  globals: viewport(1440, 900),
  render: () => shellRuns({ menu: 'repoError' }),
};
export const RunsSideMenuRepoNoBranch: Story = {
  name: 'Runs, repository block with no default branch',
  globals: viewport(1440, 900),
  render: () => shellRuns({ menu: 'repoNoBranch' }),
};
export const RunsSideProjectSwitcher: Story = {
  name: 'Runs, project switcher open',
  globals: viewport(1440, 900),
  render: () => shellRuns({ switcher: projectSwitchFixtures.ready }),
  play: openSwitcher,
};
export const RunsSideProjectSwitcherEmpty: Story = {
  name: 'Runs, project switcher with no projects',
  globals: viewport(1440, 900),
  render: () => shellRuns({ switcher: projectSwitchFixtures.empty }),
  play: openSwitcher,
};
export const RunsSideProjectSwitcherError: Story = {
  name: 'Runs, project switcher could not load',
  globals: viewport(1440, 900),
  render: () => shellRuns({ switcher: projectSwitchFixtures.error }),
  play: openSwitcher,
};
export const RunsSideProjectSwitcherLoading: Story = {
  name: 'Runs, project switcher loading',
  globals: viewport(1440, 900),
  render: () => shellRuns({ switcher: projectSwitchFixtures.loading }),
  play: openSwitcher,
};
export const RunsSideProjectSwitcherNoCreate: Story = {
  name: 'Runs, project switcher without New project',
  globals: viewport(1440, 900),
  render: () => shellRuns({ switcher: projectSwitchFixtures.noCreate }),
  play: openSwitcher,
};
/** A project the person cannot open: the org menu stays, the page says so. */
export const RunsNotFoundSideMenu: Story = {
  name: 'Runs, project not found: organization menu',
  globals: viewport(1440, 900),
  render: () => (
    <OrgShellFrame viewer="owner" page={null}>
      <main className={styles.shellMain}>
        <EmptyState
          title="Page not found"
          body="This page does not exist, or it belongs to an organization you are not in."
          action={
            <Button variant="primary" href="#projects">
              Go to projects
            </Button>
          }
        />
      </main>
    </OrgShellFrame>
  ),
};

/** The old needs-you address: the page is gone, so the project menu stays and the page says not found. */
export const RunsNeedsYouNotFound: Story = {
  name: 'Runs, removed needs-you address: not found',
  globals: viewport(1440, 900),
  render: () => (
    <ProjectShellFrame page={null}>
      <main className={styles.shellMain}>
        <EmptyState
          title="Page not found"
          body="This page does not exist, or it belongs to an organization you are not in."
          action={
            <Button variant="primary" href="#projects">
              Go to projects
            </Button>
          }
        />
      </main>
    </ProjectShellFrame>
  ),
};

// BR-65: Runs at 390x844 (phone boards): the header wraps, the search is full width, the chips scroll in one row and
// each run is a card.
const phoneArtboard: NonNullable<Story['decorators']> = [
  (S) => (
    <div style={{ width: 390, height: 844 }}>
      <ProjectShellFrame page="runs" height={844} crumbs={[{ label: 'Runs' }]}>
        <S />
      </ProjectShellFrame>
    </div>
  ),
];
const runsPhonePage = () => (
  <RunsScreen
    search={search}
    {...common}
    filter="all"
    counts={counts}
    groups={ticketGroups}
    needsYouRun={{
      run: runs.find((r) => r.id === 62)!,
      askedAgo: '3 minutes ago',
      slotNote: 'It holds one of your 2 slots, so Run 63 is waiting.',
      href: '/runs/62',
    }}
    onFinishIdle={() => undefined}
  />
);
export const RunsPhone: Story = {
  name: 'Phone: runs as cards',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  render: runsPhonePage,
};
export const RunsPhoneDrawer: Story = {
  name: 'Phone: project menu drawer',
  decorators: phoneArtboard,
  globals: viewport(390, 844),
  render: runsPhonePage,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open menu' }));
  },
};
