import { render, screen, within } from '@testing-library/react';
import { ignored, projects, runs, ticketGroups, user } from '@/mocks';
import { filterGroups, Runs, type RunsFilter } from './Runs';
import { RunsProblems } from './RunsProblems';
import { NeedsYou } from './NeedsYou';

const counts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 6, all: 9, ignored: 3 };
const project = projects[0];
const base = {
  project, user, needsYou: 1, slots: { used: 2, total: 2 }, today: 'Today: 9 runs, 1 failed', counts, groups: ticketGroups,
};
const needsYouRun = {
  run: runs.find((r) => r.id === 62)!, askedAgo: '3 minutes ago', href: '/runs/62',
  slotNote: 'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 10 minutes with nobody attached.',
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
    expect(filterGroups(ticketGroups, 'active').flatMap((x) => x.runs.map((r) => r.id))).toEqual([61]);
  });
});

describe('Runs', () => {
  it('shows only Run 62 and its #142 group for needs_you', () => {
    render(<Runs {...base} filter="needs_you" />);
    expect(runIds()).toEqual([62]);
    expect(screen.getByText('Export invoices as CSV from the billing page')).toBeInTheDocument();
    expect(screen.queryByText('Rate-limit the public webhook endpoint')).not.toBeInTheDocument();
  });

  it('shows ended runs 60, 55, 56, 57, 54, 52', () => {
    render(<Runs {...base} filter="ended" />);
    expect(runIds()).toEqual([60, 55, 56, 57, 54, 52]);
  });

  it('shows the empty state when there are no groups', () => {
    render(<Runs {...base} groups={[]} filter="all" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('orders group #131 rows 55, 56, 57 with tree mid, mid, last', () => {
    const { container } = render(<Runs {...base} filter="all" />);
    const rows = ['Run 55', 'Run 56', 'Run 57'].map((t) => screen.getByRole('link', { name: t }).closest('tr')!);
    expect(rows.map((r) => r.nextElementSibling === rows[rows.indexOf(r) + 1] || r === rows[2])).toEqual([true, true, true]);
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

  it('renders the needs-you banner, header, row actions and one main', () => {
    render(<Runs {...base} filter="all" needsYouRun={needsYouRun} />);
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
      tone: 'err' as const, icon: 'warning' as const, title: 'No webhooks from GitHub since 11:42',
      body: 'Comments posted since then have not started runs.',
      actions: [{ label: 'Check again', icon: 'refresh' as const }, { label: 'Connection details', href: '/desk/agent', variant: 'ghost' as const }],
    },
    {
      tone: 'warn' as const, icon: 'key' as const, title: 'The Claude credential was rejected',
      body: 'Run 56 failed with 401 at 11:29.', actions: [{ label: 'Replace credential', href: '/desk/agent' }],
    },
  ];

  it('lists each ignored command with reason and detail', () => {
    render(<RunsProblems {...base} filter="ignored" counts={{ ...counts, ignored: 5 }} warnings={warnings} ignored={ignored} />);
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
    expect(screen.getByRole('link', { name: 'Open run 62 in Agent Desk' })).toBeInTheDocument();
  });
});
