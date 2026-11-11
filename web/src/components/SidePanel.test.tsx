import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChainTimeline, KeyValue, Meter, Section, SidePanel, SideRail, TicketSummary, type ChainStep } from './index';
import styles from './SidePanel.module.css';

describe('Meter', () => {
  it('clamps aria-valuenow to max and min', () => {
    const { rerender } = render(<Meter value={50} max={30} aria-label="Time" />);
    const bar = screen.getByRole('progressbar', { name: 'Time' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '30');
    expect(bar.querySelector('i')).toHaveStyle({ width: '100%' });
    rerender(<Meter value={-4} max={30} aria-label="Time" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
  it('handles value 0 and max 0 without NaN', () => {
    const { rerender } = render(<Meter value={0} max={30} aria-label="Time" />);
    expect(screen.getByRole('progressbar').querySelector('i')).toHaveStyle({ width: '0%' });
    rerender(<Meter value={5} max={0} aria-label="Time" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar.querySelector('i')?.getAttribute('style')).not.toMatch(/NaN|Infinity/);
    rerender(<Meter value={Number.NaN} max={Number.NaN} aria-label="Time" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
  it('late tone uses the late class', () => {
    render(<Meter value={30} max={30} tone="late" aria-label="Time" />);
    expect(screen.getByRole('progressbar')).toHaveClass(styles.meter, styles.late);
  });
});

describe('SidePanel / SideRail / Section', () => {
  it('is a labelled aside, default "Run context"', () => {
    render(<SidePanel><Section title="Time" aside={<span>max 10 runs</span>}>x</Section></SidePanel>);
    expect(screen.getByRole('complementary', { name: 'Run context' })).toHaveClass(styles.side);
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('max 10 runs')).toBeInTheDocument();
  });
  it('rail has expand button and named items', async () => {
    const onExpand = vi.fn();
    render(<SideRail onExpand={onExpand} items={[{ icon: <svg />, title: 'Issue #139' }, { icon: <svg />, title: 'Running' }, { icon: <svg />, title: 'Chain: 1 of 2' }]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand context panel (])' }));
    expect(onExpand).toHaveBeenCalled();
    for (const n of ['Issue #139', 'Running', 'Chain: 1 of 2']) expect(screen.getByRole('img', { name: n })).toHaveAttribute('title', n);
  });
  it('rail with no items still renders the button', () => {
    render(<SideRail items={[]} />);
    expect(screen.getByRole('button', { name: 'Expand context panel (])' })).toBeInTheDocument();
  });
});

describe('KeyValue', () => {
  it('renders dt/dd pairs and term width', () => {
    const { container } = render(<KeyValue termWidth={120} items={[{ term: 'Skill', value: 'code-build' }, { term: 'Agent', value: 'Claude' }]} />);
    expect(container.querySelectorAll('dt')).toHaveLength(2);
    expect(container.querySelectorAll('dd')).toHaveLength(2);
    expect(container.querySelector('dt')).toHaveTextContent('Skill');
    expect(container.querySelector('dd')).toHaveTextContent('code-build');
    expect(container.querySelector('dl')).toHaveStyle('--kv-term: 120px');
  });
  it('renders empty', () => {
    const { container } = render(<KeyValue items={[]} />);
    expect(container.querySelectorAll('dt')).toHaveLength(0);
  });
});

describe('ChainTimeline', () => {
  const steps: ChainStep[] = [
    { runId: 60, command: '/code-build', ticket: { kind: 'issue', number: 139 }, note: 'Succeeded in 6m 12s', status: 'succeeded', href: '/runs/60' },
    { runId: 61, command: '/code-review', ticket: { kind: 'pr', number: 148 }, note: 'This run', status: 'running', here: true },
    { command: '/code-fix', context: 'on the PR it opens', note: 'Starts when the agent posts the command', status: 'future' },
  ];
  it('marks only the here step with aria-current and the here class', () => {
    render(<ChainTimeline steps={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveClass(styles.cstep, styles.here);
    expect(items[0]).not.toHaveAttribute('aria-current');
  });
  it('future step has no link, faint class and context text', () => {
    render(<ChainTimeline steps={steps} />);
    const future = screen.getAllByRole('listitem')[2];
    expect(future).toHaveClass(styles.cstep, styles.future);
    expect(within(future).queryByRole('link')).toBeNull();
    expect(within(future).getByText('on the PR it opens')).toBeInTheDocument();
    expect(within(future).getByRole('img', { name: 'Not started' })).toBeInTheDocument();
  });
  it('a step with href is a link; others are not', () => {
    render(<ChainTimeline steps={steps} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/runs/60');
    expect(screen.getByText('Run 60')).toBeInTheDocument();
  });
  it('renders nothing for empty steps', () => {
    render(<ChainTimeline steps={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('TicketSummary', () => {
  const ticket = { kind: 'issue' as const, number: 139, title: 'Rate-limit the public webhook endpoint', labels: [{ name: 'api', color: '#52C4D9' }], state: 'Open', href: 'https://github.com/x/y/issues/139' };
  it('renders link, title, labels and state', () => {
    render(<TicketSummary ticket={ticket} />);
    expect(screen.getByRole('link', { name: 'Open in GitHub' })).toHaveAttribute('href', ticket.href);
    expect(screen.getByText(ticket.title)).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });
  it('shows a diffstat and tolerates no labels/state', () => {
    render(<TicketSummary ticket={{ ...ticket, kind: 'pr', labels: [], state: undefined }} diffstat="+214 −12" />);
    expect(screen.getByText('+214 −12')).toBeInTheDocument();
    expect(screen.getByText('PR #139')).toBeInTheDocument();
  });
});
