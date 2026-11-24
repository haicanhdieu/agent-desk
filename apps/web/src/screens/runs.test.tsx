import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteLoadError, RouteSkeleton, type OrgSwitchProps } from '@/components';
import {
  orgSwitchFixtures,
  ignored,
  ignoredPrStates,
  pagedIgnored,
  pagedNeedsYou,
  pagedProjects,
  pagedRules,
  pagedRuns,
  pagedSkills,
  pagedVersions,
  prStateRuns,
  prStateTickets,
  projects,
  runs,
  ticketGroups,
  user,
} from '@/mocks';
import type { TicketGroup } from '@/mocks/types';
import { filterGroups, Runs, type RunsFilter } from './Runs';
import { RunsProblems } from './RunsProblems';
import { NeedsYou } from './NeedsYou';

const counts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 6, all: 9, ignored: 3 };
const project = projects[0];
const base = {
  project,
  user,
  needsYou: 1,
  slots: { used: 2, total: 2 },
  today: 'Today: 9 runs, 1 failed',
  counts,
  groups: ticketGroups,
};
const needsYouRun = {
  run: runs.find((r) => r.id === 62)!,
  askedAgo: '3 minutes ago',
  href: '/runs/62',
  slotNote:
    'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 30 minutes with nobody attached.',
};
const org: OrgSwitchProps = {
  ...orgSwitchFixtures.severalOrgsSettings,
  orgHref: (o) => `/o/${o.slug}`,
  createHref: '/orgs/new',
};
const runIds = () =>
  screen.queryAllByRole('link', { name: /^Run \d+$/ }).map((a) => Number(a.textContent!.replace('Run ', '')));

describe('filterGroups', () => {
  it('keeps everything for all, drops emptied groups otherwise', () => {
    expect(filterGroups(ticketGroups, 'all')).toBe(ticketGroups);
    const g = filterGroups(ticketGroups, 'needs_you');
    expect(g).toHaveLength(1);
    expect(g[0].runs.map((r) => r.id)).toEqual([62]);
    expect(filterGroups(ticketGroups, 'queued').map((x) => x.runs[0].id)).toEqual([63]);
    // `active` matches the API filter: starting, running, idle and done.
    expect(filterGroups(ticketGroups, 'active').flatMap((x) => x.runs.map((r) => r.id))).toEqual([62, 61]);
  });
});

describe('Runs under the Active filter', () => {
  it('lists a done run, as the API counts it, so the rows match the pager range', () => {
    const doneRun = { ...runs.find((r) => r.id === 61)!, id: 90, status: 'done' as const };
    const groups = [{ ...ticketGroups[0], runs: [doneRun] }];
    render(
      <Runs
        {...base}
        groups={groups}
        filter="active"
        pagination={{
          page: 1,
          pageSize: 20,
          total: 1,
          onPageChange: () => undefined,
          onPageSizeChange: () => undefined,
        }}
      />,
    );
    expect(runIds()).toEqual([90]);
    expect(screen.queryByText('No runs match this filter')).not.toBeInTheDocument();
  });
});

describe('Runs', () => {
  it('shows only Run 62 and its #142 group for needs_you', () => {
    render(<Runs {...base} filter="needs_you" />);
    expect(runIds()).toEqual([62]);
    expect(screen.getByText('Export invoices as CSV from the billing page')).toBeInTheDocument();
    expect(screen.queryByText('Rate-limit the public webhook endpoint')).not.toBeInTheDocument();
  });

  it('has a Routing rule column header and no Skill column', () => {
    render(<Runs {...base} filter="all" />);
    expect(screen.getByRole('columnheader', { name: 'Routing rule' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Skill' })).not.toBeInTheDocument();
  });

  it('has a Usage column header after Duration and shows each row cell from the fixture', () => {
    render(<Runs {...base} filter="all" />);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads.indexOf('Usage')).toBe(heads.indexOf('Duration') + 1);
    const row = (id: number) => {
      const tr = screen.getByRole('link', { name: new RegExp(`^Run ${id}\\b`) }).closest('tr');
      if (!tr) throw new Error(`no row for run ${id}`);
      return tr;
    };
    expect(row(60)).toHaveTextContent('48.2k · ~$0.42');
    expect(row(55)).toHaveTextContent('61.2k · ~$0.42+');
    expect(row(63)).toHaveTextContent('No usage data');
    expect(row(60)).not.toHaveTextContent(/model-|cache|Nov 2026/i);
  });

  it('shows ended runs 60, 55, 56, 57, 54, 52', () => {
    render(<Runs {...base} filter="ended" />);
    expect(runIds()).toEqual([60, 55, 56, 57, 54, 52]);
  });

  it('shows the empty state when there are no groups', () => {
    render(<Runs {...base} groups={[]} filter="all" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'No runs match this filter' })).toBeInTheDocument();
  });

  describe('search', () => {
    it('shows no search box without a search prop (the Ignored view)', () => {
      render(<Runs {...base} filter="all" />);
      expect(screen.queryByRole('searchbox', { name: 'Search runs' })).not.toBeInTheDocument();
    });

    it('shows the typed text and reports edits and the clear button', async () => {
      const onChange = vi.fn();
      render(<Runs {...base} filter="all" search={{ value: 'log', applied: 'log', onChange }} />);
      const box = screen.getByRole('searchbox', { name: 'Search runs' });
      expect(box).toHaveValue('log');
      await userEvent.type(box, 'i');
      expect(onChange).toHaveBeenLastCalledWith('logi');
      await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
      expect(onChange).toHaveBeenLastCalledWith('');
    });

    it('an empty result for a search says so with the query, apart from the status-filter empty state', async () => {
      const onChange = vi.fn();
      render(<Runs {...base} groups={[]} filter="ended" search={{ value: 'zzz', applied: 'zzz', onChange }} />);
      expect(screen.getByRole('heading', { level: 2, name: 'No runs match “zzz”' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'No runs match this filter' })).not.toBeInTheDocument();
      const clear = screen.getAllByRole('button', { name: 'Clear search' });
      await userEvent.click(clear[clear.length - 1]);
      expect(onChange).toHaveBeenLastCalledWith('');
    });

    it('with no query the status-filter empty state stays', () => {
      render(<Runs {...base} groups={[]} filter="ended" search={{ value: '', applied: '', onChange: () => {} }} />);
      expect(screen.getByRole('heading', { level: 2, name: 'No runs match this filter' })).toBeInTheDocument();
    });

    it('marks the results region busy while a search loads, and keeps the box editable', () => {
      render(
        <Runs
          {...base}
          filter="all"
          search={{ value: 'a', applied: '', onChange: () => {} }}
          pagination={{
            page: 1,
            pageSize: 20,
            total: 9,
            busy: true,
            onPageChange: () => {},
            onPageSizeChange: () => {},
          }}
        />,
      );
      expect(screen.getByRole('region', { name: 'Run results' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('searchbox', { name: 'Search runs' })).toBeEnabled();
    });
  });

  it('orders group #131 rows 55, 56, 57 with tree mid, mid, last', () => {
    const { container } = render(<Runs {...base} filter="all" />);
    const rows = ['Run 55', 'Run 56', 'Run 57'].map((t) => screen.getByRole('link', { name: t }).closest('tr')!);
    expect(rows.map((r) => r.nextElementSibling === rows[rows.indexOf(r) + 1] || r === rows[2])).toEqual([
      true,
      true,
      true,
    ]);
    const trees = rows.map((r) => r.querySelector('span[aria-hidden="true"]')!.className);
    expect(trees[0]).toMatch(/mid/);
    expect(trees[1]).toMatch(/mid/);
    expect(trees[2]).not.toMatch(/mid/);
    expect(container.querySelectorAll('tr')).toHaveLength(1 + 6 + 9);
  });

  it('marks the active chip pressed and takes chip counts from props', () => {
    render(<Runs {...base} filter="ended" />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(group).getByRole('button', { name: /^Ended/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: /^All/ })).toHaveTextContent('9');
    expect(screen.getByRole('button', { name: /^Ignored/ })).toHaveTextContent('3');
  });

  it('calls onFilter with the clicked chip', async () => {
    const onFilter = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<Runs {...base} filter="all" onFilter={onFilter} />);
    await userEvent.click(screen.getByRole('button', { name: /^Queued/ }));
    expect(onFilter).toHaveBeenCalledWith('queued');
  });

  it('toggles ticket grouping with the Grouped by ticket button without changing the runs', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { container } = render(<Runs {...base} filter="all" />);
    const toggle = () => screen.getByRole('button', { name: 'Grouped by ticket' });
    const groupTitle = 'Rate-limit the public webhook endpoint';
    const idsBefore = runIds().sort((a, b) => a - b);
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveClass('pressed');
    expect(screen.getByText(groupTitle)).toBeInTheDocument();
    expect(container.querySelectorAll('tr')).toHaveLength(1 + 6 + 9);

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).not.toHaveClass('pressed');
    expect(screen.queryByText(/ of \d+ runs$/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('tr')).toHaveLength(1 + 9);
    expect(runIds().sort((a, b) => a - b)).toEqual(idsBefore);
    expect(runIds()).toEqual([...runIds()].sort((a, b) => b - a));

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(toggle()).toHaveClass('pressed');
    expect(screen.getByText(groupTitle)).toBeInTheDocument();
    expect(container.querySelectorAll('tr')).toHaveLength(1 + 6 + 9);
  });

  it('waitingRun shows the waiting note and no idle-run text or actions', () => {
    render(<Runs {...base} filter="all" waitingRun={63} />);
    expect(screen.getByText('Run 63 is waiting for a free slot.')).toBeInTheDocument();
    expect(screen.queryByText(/needs you\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Answer in terminal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish run' })).not.toBeInTheDocument();
  });

  it('the idle banner has no Finish run without onFinishIdle (the viewer may not finish this run)', () => {
    render(<Runs {...base} filter="all" needsYouRun={needsYouRun} />);
    expect(screen.getByRole('link', { name: 'Answer in terminal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish run' })).not.toBeInTheDocument();
  });

  it('the idle banner wins over waitingRun, which would repeat its slot note', () => {
    render(<Runs {...base} filter="all" needsYouRun={needsYouRun} waitingRun={63} />);
    expect(screen.getByText('Run 62 needs you.')).toBeInTheDocument();
    expect(screen.queryByText('Run 63 is waiting for a free slot.')).not.toBeInTheDocument();
  });

  it('renders the needs-you banner, header, row actions and one main', () => {
    render(
      <Runs
        {...base}
        filter="all"
        needsYouRun={needsYouRun}
        onFinishIdle={() => undefined}
        search={{ value: '', applied: '', onChange: () => undefined }}
      />,
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByText('Run 62 needs you.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Answer in terminal' })).toHaveAttribute('href', '/runs/62');
    expect(screen.getByRole('button', { name: 'Finish run' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open terminal' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Watch' })).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grouped by ticket' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('Ticket number or title')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders the chips as links when filterHref is given', () => {
    render(<Runs {...base} filter="queued" filterHref={(f) => `/runs?filter=${f}`} />);
    const group = screen.getByRole('group', { name: 'Filter by status' });
    expect(within(group).getByRole('link', { name: /^Queued/ })).toHaveAttribute('aria-current', 'page');
    expect(within(group).getByRole('link', { name: /^All/ })).toHaveAttribute('href', '/runs?filter=all');
    expect(within(group).getByRole('link', { name: /^All/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: /^Ignored/ })).toHaveAttribute('href', '/runs?filter=ignored');
  });

  it('uses runHref for run links and showAllHref for the empty state', () => {
    render(<Runs {...base} filter="all" runHref={(r) => `/p/x/runs/${r.id}`} />);
    expect(screen.getByRole('link', { name: 'Run 61' })).toHaveAttribute('href', '/p/x/runs/61');
    expect(screen.getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/p/x/runs/61');
  });

  it('links "Show all runs" when showAllHref is given', () => {
    render(<Runs {...base} groups={[]} filter="queued" showAllHref="/p/x/runs" />);
    expect(screen.getByRole('link', { name: 'Show all runs' })).toHaveAttribute('href', '/p/x/runs');
  });

  it('gives long ticket titles an ellipsis title attribute', () => {
    const long = 'x'.repeat(200);
    const groups = [{ ...ticketGroups[0], ticket: { ...ticketGroups[0].ticket, title: long } }];
    render(<Runs {...base} groups={groups} filter="all" />);
    expect(screen.getByText(long)).toHaveAttribute('title', long);
  });
});

describe('RunsProblems', () => {
  const warnings = [
    {
      tone: 'err' as const,
      icon: 'warning' as const,
      title: 'No webhooks from GitHub since 11:42',
      body: 'Comments posted since then have not started runs.',
      actions: [
        { label: 'Check again', icon: 'refresh' as const },
        { label: 'Connection details', href: '/desk/agent', variant: 'ghost' as const },
      ],
    },
    {
      tone: 'warn' as const,
      icon: 'key' as const,
      title: 'The Claude credential was rejected',
      body: 'Run 56 failed with 401 at 11:29.',
      actions: [{ label: 'Replace credential', href: '/desk/agent' }],
    },
  ];

  it('lists each ignored command with reason and detail', () => {
    render(
      <RunsProblems
        {...base}
        filter="ignored"
        counts={{ ...counts, ignored: 5 }}
        warnings={warnings}
        ignored={ignored}
      />,
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Ignored commands' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    ignored.forEach((ig, i) => {
      expect(within(rows[i]).getByText(ig.reason)).toBeInTheDocument();
      expect(within(rows[i]).getByText(ig.detail)).toBeInTheDocument();
      expect(within(rows[i]).getByText(ig.command)).toBeInTheDocument();
      expect(within(rows[i]).getByText(ig.at)).toBeInTheDocument();
      expect(within(rows[i]).getByRole('link', { name: /Comment/ })).toHaveAttribute('href', ig.href);
    });
    expect(screen.getByRole('button', { name: /^Ignored/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows two banners without a live role', () => {
    render(<RunsProblems {...base} filter="ignored" warnings={warnings} ignored={ignored} />);
    expect(screen.getByText('No webhooks from GitHub since 11:42')).toBeInTheDocument();
    expect(screen.getByText('The Claude credential was rejected')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Replace credential' })).toHaveAttribute('href', '/desk/agent');
  });
});

describe('NeedsYou', () => {
  it('renders four captioned surfaces in one main', () => {
    render(<NeedsYou project={project} projects={projects} />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Where "needs you" shows up' })).toBeInTheDocument();
    expect(screen.getAllByRole('figure')).toHaveLength(4);
    expect(screen.getByText('(1) Needs you, invoicer-api')).toBeInTheDocument();
    expect(screen.getByText('Run 62 needs you')).toBeInTheDocument();
    expect(screen.getByText(/ends on its own after 30 minutes with no one attached/)).toBeInTheDocument();
    expect(screen.getByText(/ends on its own at 14:43 if nobody opens it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open run 62 in Agent Desk' })).toHaveAttribute('href', '/runs/62');
  });

  it('lists the given idle runs with their hrefs, or says none need you', () => {
    const run = runs.find((r) => r.id === 62)!;
    const { unmount } = render(
      <NeedsYou
        project={project}
        projects={projects}
        runs={[{ run, href: '/p/x/runs/62', idleAt: '14:13', endsAt: '14:43' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open run 62 in Agent Desk' })).toHaveAttribute('href', '/p/x/runs/62');
    unmount();
    render(<NeedsYou project={project} projects={projects} runs={[]} />);
    expect(screen.getAllByText('No runs need you right now.')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Open run/ })).not.toBeInTheDocument();
  });
});

describe('RunsProblems empty', () => {
  it('shows an empty state when nothing was ignored', () => {
    render(<RunsProblems {...base} filter="ignored" warnings={[]} ignored={[]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No ignored commands' })).toBeInTheDocument();
  });
});

describe('pagination on the run screens', () => {
  const pagination = (total: number, busy = false) => ({
    page: 4,
    pageSize: 20 as const,
    total,
    busy,
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
  });

  it('Runs draws the pagination control under the table and marks the table busy', () => {
    render(<Runs {...base} filter="all" pagination={pagination(63, true)} />);
    const table = screen.getByRole('table');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(table.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Runs without a busy page leaves aria-busy off the table', () => {
    render(<Runs {...base} filter="all" pagination={pagination(63)} />);
    expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy');
  });

  it('Runs with no runs shows the empty state and no control', () => {
    render(<Runs {...base} groups={[]} filter="all" pagination={pagination(0)} />);
    expect(screen.getByText('No runs match this filter')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });

  it('RunsProblems draws the control under the ignored rows', () => {
    render(
      <RunsProblems {...base} filter="ignored" warnings={[]} ignored={ignored} pagination={pagination(27, true)} />,
    );
    const table = screen.getByRole('table');
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(table.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('NeedsYou draws the control under the cards', () => {
    const run = runs.find((r) => r.id === 62)!;
    render(
      <NeedsYou
        project={project}
        projects={projects}
        runs={[{ run, href: '/runs/62', idleAt: '14:13', endsAt: '14:43' }]}
        pagination={pagination(21, true)}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    const card = screen.getByRole('link', { name: 'Open run 62 in Agent Desk' });
    expect(card.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('NeedsYou draws no control when the list is empty', () => {
    render(<NeedsYou project={project} projects={projects} runs={[]} pagination={pagination(21, true)} />);
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });
});

describe('RouteStates', () => {
  it('RouteSkeleton is a busy status', () => {
    render(<RouteSkeleton />);
    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('RouteLoadError shows title, request ID and Retry', async () => {
    const onRetry = vi.fn();
    render(<RouteLoadError title="Internal server error" detail="Try again." requestId="req-9" onRetry={onRetry} />);
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
    expect(screen.getByText(/Request ID: req-9/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('paged fixtures', () => {
  it('pagedRuns is newest first and deterministic', () => {
    const a = pagedRuns(63);
    expect(a.map((r) => r.id).slice(0, 2)).toEqual([63, 62]);
    expect(a.at(-1)?.id).toBe(1);
    expect(a).toHaveLength(63);
    expect(pagedRuns(63)).toEqual(a);
  });
  it('the other fixtures hold exactly total rows', () => {
    expect(pagedIgnored(27)).toHaveLength(27);
    expect(pagedNeedsYou(21)).toHaveLength(21);
    expect(pagedProjects(25)).toHaveLength(25);
    expect(pagedRules(25)).toHaveLength(25);
    expect(pagedSkills(25)).toHaveLength(25);
    expect(pagedVersions(25).map((v) => v.version)).toEqual(Array.from({ length: 25 }, (_, i) => 25 - i));
  });
});

describe('PR state colours on the Runs screen', () => {
  const prGroups: TicketGroup[] = prStateRuns.map((r) => ({
    ticket: r.ticket,
    runsUsed: 1,
    runsMax: 10,
    runs: [r],
  }));
  const words = ['Open', 'Draft', 'Merged', 'Closed'];

  it('every PR icon on the Runs screen shows its state', () => {
    render(<Runs {...base} filter="all" groups={prGroups} />);
    // Each PR appears twice: once in its group header, once in its run row.
    for (const w of words) expect(screen.getAllByRole('img', { name: w })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Merged PR #172' })).toHaveLength(2);
    const unknown = screen.getAllByRole('link', { name: 'PR #174' });
    expect(unknown).toHaveLength(2);
    for (const a of unknown) expect(within(a).queryByRole('img')).not.toBeInTheDocument();
  });

  it("the banner's PR icon shows its state", () => {
    const run = { ...needsYouRun.run, ticket: prStateTickets.merged };
    render(<Runs {...base} filter="all" needsYouRun={{ ...needsYouRun, run }} />);
    const banner = screen.getByRole('link', { name: 'Merged PR #172' });
    expect(within(banner).getByRole('img', { name: 'Merged' })).toBeInTheDocument();
  });

  it('Ignored PR rows show their state; issue rows do not', () => {
    render(
      <RunsProblems
        {...base}
        counts={{ ...counts, ignored: 6 }}
        warnings={[]}
        ignored={[ignored[0], ...ignoredPrStates]}
      />,
    );
    for (const w of words) expect(screen.getAllByRole('img', { name: w })).toHaveLength(1);
    const issueRow = screen.getByText('Issue #160').closest('tr')!;
    expect(within(issueRow).queryByRole('img')).not.toBeInTheDocument();
    const unknownRow = screen.getByText('PR #174').closest('tr')!;
    expect(within(unknownRow).queryByRole('img')).not.toBeInTheDocument();
  });

  it("a merged group's issue header and chain note stay plain", () => {
    render(<Runs {...base} filter="all" groups={[ticketGroups[0]]} />);
    const header = screen.getByText(ticketGroups[0].chainNote!).closest('tr')!;
    expect(within(header).queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Runs under the app bar (BR-43)', () => {
  it('with org: the org crumb, the project crumb, Runs current with the needs-you count, and Settings', () => {
    render(<Runs {...base} filter="all" org={org} links={{ desk: '/desk' }} />);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: /^Switch scope, currently organization Acme/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /invoicer-api/ })).toBeInTheDocument();
    const tabs = within(bar).getByRole('navigation', { name: 'Project sections' });
    expect(within(tabs).getByRole('link', { name: /^Runs/ })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: /^Runs/ })).toHaveTextContent('1');
    expect(within(tabs).getByRole('link', { name: 'Project settings' })).not.toHaveAttribute('aria-current');
  });

  it('without org: no org crumb and no owner text, only the project', () => {
    render(<Runs {...base} filter="all" />);
    const bar = screen.getByRole('banner');
    expect(within(bar).queryByRole('button', { name: /organization/i })).toBeNull();
    expect(within(bar).queryByText(project.org)).toBeNull();
    expect(within(bar).getByRole('button', { name: /^Switch project/ })).toBeInTheDocument();
  });

  it('NeedsYou with topBar.org renders the org bar: Projects tab, no tab current, no project crumb', () => {
    render(<NeedsYou project={project} projects={projects} topBar={{ user, org }} />);
    const bar = screen.getByRole('banner');
    expect(within(bar).getByRole('button', { name: /^Switch scope, currently organization Acme/ })).toBeInTheDocument();
    const tabs = within(bar).getByRole('navigation', { name: 'Organization sections' });
    expect(within(tabs).getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(within(tabs).queryByRole('link', { current: 'page' })).toBeNull();
    expect(within(tabs).queryByRole('link', { name: /^Runs/ })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Notifications on' })).toBeInTheDocument();
  });

  it('NeedsYou has one Main nav: the example strip in the page is labelled apart from the bar', () => {
    render(<NeedsYou project={project} projects={projects} topBar={{ user, org }} />);
    expect(screen.getAllByRole('navigation', { name: 'Organization sections' })).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: 'Runs and Settings tabs, example' })).toBeInTheDocument();
  });
});
