import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RunSummary, TicketGroup } from '@/mocks/types';
import { usageCellValue } from '@/mocks/usage';
import { DataTable } from './DataTable';
import { EmptyState } from './EmptyState';
import { FilterChip, FilterChips } from './FilterChip';
import { NeedsYouBanner } from './NeedsYouBanner';
import { RunRow, TicketGroupRow } from './RunRow';

const ticket = {
  kind: 'issue' as const,
  number: 142,
  title: 'Export invoices',
  labels: [],
  href: 'https://github.com/x/142',
};
const run: RunSummary = {
  id: 62,
  status: 'idle',
  command: '/review',
  skill: 'code-review',
  agent: 'claude',
  model: 'opus',
  ticket,
  triggeredBy: { login: 'agent-desk[bot]', bot: true },
  startedAt: '14:09',
  duration: '4m 51s',
};

function inTable(ui: React.ReactNode) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>,
  );
}

describe('RunRow', () => {
  it('idle run has needs class and a pill badge', () => {
    const { container } = inTable(<RunRow run={run} tree="last" href="/runs/62" />);
    const tr = container.querySelector('tr')!;
    expect(tr.className).toMatch(/needs/);
    expect(tr.className).toMatch(/child/);
    expect(screen.getByTitle('status: idle').className).toMatch(/st-pill/);
    expect(screen.getByRole('link', { name: 'Run 62' })).toHaveAttribute('href', '/runs/62');
  });

  it('non-idle run has no needs class and a text badge', () => {
    const { container } = inTable(<RunRow run={{ ...run, status: 'running' }} tree="last" href="/r" />);
    expect(container.querySelector('tr')!.className).not.toMatch(/needs/);
    expect(screen.getByTitle('status: running').className).not.toMatch(/st-pill/);
  });

  it('missing duration shows a dash', () => {
    inTable(
      <RunRow run={{ ...run, status: 'queued', duration: undefined, usage: usageCellValue }} tree="last" href="/r" />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('tree mid renders .tree.mid, last does not', () => {
    const a = inTable(<RunRow run={run} tree="mid" href="/r" />);
    const el = a.container.querySelector('[class*="tree"]')!;
    expect(el.className).toMatch(/mid/);
    a.unmount();
    const b = inTable(<RunRow run={run} tree="last" href="/r" />);
    expect(b.container.querySelector('[class*="tree"]')!.className).not.toMatch(/mid/);
  });

  it('shows status note, short issue ref, and actions', () => {
    inTable(
      <RunRow
        run={{ ...run, statusNote: 'Waiting 3m', ticket: { ...ticket, kind: 'pr', number: 148 } }}
        tree="last"
        href="/r"
        actions={<button>Finish</button>}
      />,
    );
    expect(screen.getByText('Waiting 3m')).toBeInTheDocument();
    expect(screen.getByText('PR #148')).toBeInTheDocument();
    expect(screen.getByText('agent-desk[bot]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  });

  it('issue tickets use the short ref', () => {
    inTable(<RunRow run={{ ...run, status: 'running' }} tree="last" href="/r" />);
    expect(screen.getByText('#142')).toBeInTheDocument();
  });
});

describe('RunRow agent', () => {
  it('shows the agent name and model the run was queued with', () => {
    inTable(<RunRow run={{ ...run, agent: 'Claude - Work', model: 'opus-4' }} tree="none" href="/r" />);
    expect(screen.getByText('Claude - Work · opus-4')).toBeInTheDocument();
  });
});

describe('RunRow routing rule', () => {
  it('shows the run command in the rule cell', () => {
    inTable(<RunRow run={run} tree="last" href="/r" />);
    expect(screen.getByText('/review')).toBeInTheDocument();
    expect(screen.queryByText('code-review')).not.toBeInTheDocument();
  });

  it('shows a dash when no command was recorded', () => {
    inTable(<RunRow run={{ ...run, command: '', duration: '1m', usage: usageCellValue }} tree="last" href="/r" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('keeps the full command in the title attribute', () => {
    const long = '/' + 'very-long-routing-rule-command-'.repeat(6);
    inTable(<RunRow run={{ ...run, command: long }} tree="last" href="/r" />);
    expect(screen.getByText(long)).toHaveAttribute('title', long);
  });
});

describe('RunRow ticket link', () => {
  it('links the ticket number to GitHub in a new window', () => {
    inTable(<RunRow run={run} tree="last" href="/runs/62" />);
    const link = screen.getByRole('link', { name: '#142' });
    expect(link).toHaveAttribute('href', ticket.href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Run 62' })).not.toHaveAttribute('target');
  });

  it('shows the ticket number as plain text when the href is empty', () => {
    inTable(<RunRow run={{ ...run, ticket: { ...ticket, href: '' } }} tree="last" href="/runs/62" />);
    expect(screen.queryByRole('link', { name: '#142' })).toBeNull();
    expect(screen.getByText('#142')).toBeInTheDocument();
  });
});

describe('RunRow ticket title', () => {
  it('shows the ticket or PR title under the ticket number when the list is not grouped', () => {
    inTable(<RunRow run={run} tree="none" href="/runs/62" />);
    const title = screen.getByText(ticket.title);
    expect(title).toHaveAttribute('title', ticket.title);
    expect(title.closest('td')).toContainElement(screen.getByRole('link', { name: '#142' }));
  });

  it('shows the title of a PR run too', () => {
    inTable(
      <RunRow
        run={{ ...run, ticket: { ...ticket, kind: 'pr', number: 148, title: 'Add CSV export' } }}
        tree="none"
        href="/runs/62"
      />,
    );
    expect(screen.getByText('Add CSV export')).toBeInTheDocument();
  });

  it('leaves the title to the group row when the run sits under a ticket group', () => {
    inTable(<RunRow run={run} tree="last" href="/runs/62" />);
    expect(screen.queryByText(ticket.title)).toBeNull();
  });
});

describe('TicketGroupRow', () => {
  const long = 'A'.repeat(200);
  const group: TicketGroup = {
    ticket: { ...ticket, title: long, labels: [{ name: 'user-story', color: '#7C8FD8' }] },
    chainNote: 'Issue #142 (2 of 10 runs)',
    runsUsed: 2,
    runsMax: 10,
    runs: [],
  };

  it('long title is ellipsised with full text in title attr', () => {
    inTable(<TicketGroupRow group={group} colSpan={8} />);
    const t = screen.getByText(long);
    expect(t).toHaveAttribute('title', long);
    expect(t.className).toMatch(/grpTitle/);
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
    expect(screen.getByText('Issue #142 (2 of 10 runs)')).toBeInTheDocument();
    expect(screen.getByText('user-story')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open #142 in GitHub' })).toHaveAttribute('href', ticket.href);
  });

  it('a merged header shows the chain note with its full text as title, and no count on the right', () => {
    const note = 'Issue #142 (1 of 10 runs) → PR #148 (1 of 10 runs)';
    inTable(
      <TicketGroupRow
        group={{
          ...group,
          chainNote: note,
          runsUsed: 1,
          linked: [{ ticket: { kind: 'pr', number: 148 }, runsUsed: 1 }],
        }}
        colSpan={8}
      />,
    );
    expect(screen.getByText(note)).toHaveAttribute('title', note);
    expect(screen.queryByText(/^\d+ of 10 runs$/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Issue #142' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open #142 in GitHub' })).toBeInTheDocument();
  });

  it('an unlimited project (runsMax 0) shows no standalone count on a single-ticket header', () => {
    inTable(<TicketGroupRow group={{ ...group, runsMax: 0, chainNote: undefined }} colSpan={8} />);
    expect(screen.queryByText(/ of \d+ runs/)).toBeNull();
  });

  it('an unlimited linked chain shows the chain note without count suffixes and no count on the right', () => {
    const note = 'Issue #303 → PR #304';
    inTable(
      <TicketGroupRow
        group={{
          ...group,
          runsMax: 0,
          chainNote: note,
          linked: [{ ticket: { kind: 'pr', number: 304 }, runsUsed: 1 }],
        }}
        colSpan={8}
      />,
    );
    expect(screen.getByText(note)).toHaveAttribute('title', note);
    expect(screen.queryByText(/ of \d+ runs/)).toBeNull();
  });

  it('a single-ticket header keeps N of max runs on the right', () => {
    const { unmount } = inTable(<TicketGroupRow group={group} colSpan={8} />);
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
    unmount();
    inTable(<TicketGroupRow group={{ ...group, linked: [] }} colSpan={8} />);
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
  });

  it('links the ticket number to GitHub in a new window', () => {
    inTable(<TicketGroupRow group={group} colSpan={8} />);
    const link = screen.getByRole('link', { name: 'Issue #142' });
    expect(link).toHaveAttribute('href', ticket.href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders no external link when the ticket href is empty (untrusted URL dropped)', () => {
    inTable(<TicketGroupRow group={{ ...group, ticket: { ...group.ticket, href: '' } }} colSpan={8} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
  });

  it('spans colSpan columns', () => {
    const { container } = inTable(<TicketGroupRow group={group} colSpan={8} />);
    expect(container.querySelector('td')).toHaveAttribute('colspan', '8');
  });
});

describe('DataTable', () => {
  it('renders th scope=col headers', () => {
    render(
      <DataTable
        columns={[
          { key: 'a', header: 'Name' },
          { key: 'b', header: 'Count', align: 'right', width: 80 },
        ]}
      >
        <tr>
          <td>x</td>
          <td>1</td>
        </tr>
      </DataTable>,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('scope', 'col');
    expect(screen.getByRole('columnheader', { name: 'Count' })).toHaveAttribute('scope', 'col');
  });
});

describe('FilterChip', () => {
  it('exposes aria-pressed and count, and fires onClick', async () => {
    const onClick = vi.fn();
    render(<FilterChip label="Needs you" count={3} on onClick={onClick} />);
    const b = screen.getByRole('button', { name: /Needs you/ });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(b.className).toMatch(/\bon\b/);
    expect(screen.getByText('3').tagName).toBe('B');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });

  it('off chip is aria-pressed false', () => {
    render(<FilterChip label="All" on={false} onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('FilterChips is a named group', () => {
    render(
      <FilterChips aria-label="Filter runs">
        <FilterChip label="All" on onClick={() => {}} />
      </FilterChips>,
    );
    expect(screen.getByRole('group', { name: 'Filter runs' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title, body and action', () => {
    render(<EmptyState title="No runs yet" body="Comment /build on an issue." action={<button>Open GitHub</button>} />);
    expect(screen.getByText('No runs yet')).toBeInTheDocument();
    expect(screen.getByText('Comment /build on an issue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open GitHub' })).toBeInTheDocument();
  });

  it('titles with an h3 by default and an h2 when asked', () => {
    const { unmount } = render(<EmptyState title="Nothing here" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Nothing here' })).toBeInTheDocument();
    unmount();
    render(<EmptyState title="Nothing here" headingLevel={2} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeInTheDocument();
  });
});

describe('NeedsYouBanner', () => {
  const props = { run, askedAgo: '3 minutes ago', slotNote: 'note', href: '/runs/62' };

  it('links the ticket number to GitHub in a new window', () => {
    render(<NeedsYouBanner {...props} />);
    const link = screen.getByRole('link', { name: 'Issue #142' });
    expect(link).toHaveAttribute('href', ticket.href);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the ticket number as plain text when the href is empty', () => {
    render(<NeedsYouBanner {...props} run={{ ...run, ticket: { ...ticket, href: '' } }} />);
    expect(screen.queryByRole('link', { name: 'Issue #142' })).toBeNull();
    expect(screen.getByText('Issue #142')).toBeInTheDocument();
  });
});
