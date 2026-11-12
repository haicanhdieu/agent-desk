import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RunSummary, TicketGroup } from '@/mocks/types';
import { DataTable } from './DataTable';
import { EmptyState } from './EmptyState';
import { FilterChip, FilterChips } from './FilterChip';
import { RunRow, TicketGroupRow } from './RunRow';

const ticket = { kind: 'issue' as const, number: 142, title: 'Export invoices', labels: [], href: 'https://github.com/x/142' };
const run: RunSummary = {
  id: 62, status: 'idle', command: '/review', skill: 'code-review', agent: 'claude', model: 'opus',
  ticket, triggeredBy: { login: 'agent-desk[bot]', bot: true }, startedAt: '14:09', duration: '4m 51s',
};

function inTable(ui: React.ReactNode) {
  return render(<table><tbody>{ui}</tbody></table>);
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
    inTable(<RunRow run={{ ...run, status: 'queued', duration: undefined }} tree="last" href="/r" />);
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
    inTable(<RunRow run={{ ...run, statusNote: 'Waiting 3m', ticket: { ...ticket, kind: 'pr', number: 148 } }} tree="last" href="/r" actions={<button>Finish</button>} />);
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

describe('TicketGroupRow', () => {
  const long = 'A'.repeat(200);
  const group: TicketGroup = {
    ticket: { ...ticket, title: long, labels: [{ name: 'user-story', color: '#7C8FD8' }] },
    chainNote: 'Issue #142 → PR #148', runsUsed: 2, runsMax: 10, runs: [],
  };

  it('long title is ellipsised with full text in title attr', () => {
    inTable(<TicketGroupRow group={group} colSpan={8} />);
    const t = screen.getByText(long);
    expect(t).toHaveAttribute('title', long);
    expect(t.className).toMatch(/grpTitle/);
    expect(screen.getByText('2 of 10 runs')).toBeInTheDocument();
    expect(screen.getByText('Issue #142 → PR #148')).toBeInTheDocument();
    expect(screen.getByText('user-story')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open #142 in GitHub' })).toHaveAttribute('href', ticket.href);
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
      <DataTable columns={[{ key: 'a', header: 'Name' }, { key: 'b', header: 'Count', align: 'right', width: 80 }]}>
        <tr><td>x</td><td>1</td></tr>
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
    render(<FilterChips aria-label="Filter runs"><FilterChip label="All" on onClick={() => {}} /></FilterChips>);
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
});
