import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar } from './Avatar';
import { CommandChip } from './CommandChip';
import { CountBadge } from './CountBadge';
import { InlineStatus } from './InlineStatus';
import { LabelChip } from './LabelChip';
import { StepNumber } from './StepNumber';
import { TicketIcon, TicketRef } from './TicketRef';
import { PR_STATES } from './tokens';

describe('CountBadge', () => {
  it('renders nothing for 0 and undefined', () => {
    const a = render(<CountBadge count={0} />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(<CountBadge count={undefined} />);
    expect(b.container).toBeEmptyDOMElement();
  });
  it('shows count and label', () => {
    render(<CountBadge count={3} label="needs you" />);
    expect(screen.getByText('3 needs you')).toHaveClass('count-idle');
  });
  it('shows just the number', () => {
    render(<CountBadge count={2} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('bot has class bot and is hidden without title', () => {
    const { container } = render(<Avatar kind="bot" />);
    expect(container.firstElementChild).toHaveClass('avatar', 'bot');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
  it('user shows initials; title exposes it; sm class', () => {
    render(<Avatar initials="MN" size="sm" title="Minh" />);
    const el = screen.getByTitle('Minh');
    expect(el).toHaveTextContent('MN');
    expect(el).toHaveClass('sm');
    expect(el).not.toHaveAttribute('aria-hidden');
  });
});

describe('TicketRef', () => {
  it('renders PR text', () => {
    render(<TicketRef kind="pr" number={148} />);
    expect(screen.getByText('PR #148')).toHaveClass('tref');
  });
  it('renders short issue', () => {
    render(<TicketRef kind="issue" number={142} short />);
    expect(screen.getByText('#142')).toBeInTheDocument();
  });
  it('renders long issue', () => {
    render(<TicketRef kind="issue" number={139} />);
    expect(screen.getByText('Issue #139')).toBeInTheDocument();
  });
  it('links to the ticket in a new window when given an href', () => {
    render(<TicketRef kind="pr" number={148} href="https://github.com/x/y/pull/148" />);
    const link = screen.getByRole('link', { name: 'PR #148' });
    expect(link).toHaveAttribute('href', 'https://github.com/x/y/pull/148');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('stays plain text when the href is empty or missing', () => {
    render(
      <>
        <TicketRef kind="pr" number={148} href="" />
        <TicketRef kind="issue" number={142} short />
      </>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('PR #148')).toBeInTheDocument();
  });
  it('TicketRef colours a merged PR icon with the merged token', () => {
    render(<TicketRef kind="pr" number={148} prState="merged" />);
    const icon = screen.getByRole('img', { name: 'Merged' });
    expect(icon.parentElement).toHaveClass('prMerged');
    expect(icon.parentElement).toHaveAttribute('title', 'Merged');
    expect(screen.getByText('PR #148')).toBeInTheDocument();
  });
  it.each([
    ['open', 'Open', 'prOpen'],
    ['draft', 'Draft', 'prDraft'],
    ['merged', 'Merged', 'prMerged'],
    ['closed', 'Closed', 'prClosed'],
  ] as const)('gives a %s PR its word and class', (state, word, cls) => {
    expect(PR_STATES).toContain(state);
    render(<TicketRef kind="pr" number={1} prState={state} />);
    expect(screen.getByRole('img', { name: word }).parentElement).toHaveClass(cls);
  });
  it('a linked coloured TicketRef reads "Merged PR #148"', () => {
    render(<TicketRef kind="pr" number={148} prState="merged" href="https://github.com/x/y/pull/148" />);
    expect(screen.getByRole('link', { name: 'Merged PR #148' })).toBeInTheDocument();
  });
  it('an unknown PR keeps the neutral glyph', () => {
    const { container } = render(<TicketRef kind="pr" number={148} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[title]')).toBeNull();
  });
  it('an issue ignores prState', () => {
    const { container } = render(<TicketRef kind="issue" number={142} prState="merged" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('.prMerged')).toBeNull();
  });
  it('TicketIcon renders 16 px', () => {
    const { container } = render(<TicketIcon kind="pr" prState="open" size={16} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '16');
  });
});

describe('LabelChip', () => {
  it('exposes a remove button', async () => {
    const fn = vi.fn();
    render(<LabelChip name="user-story" onRemove={fn} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove label user-story' }));
    expect(fn).toHaveBeenCalled();
  });
  it('no button without onRemove; idle tone class', () => {
    render(<LabelChip name="Unsaved changes" tone="idle" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Unsaved changes').closest('.lbl')).toHaveClass('idle');
  });
});

describe('StepNumber', () => {
  it('done renders no digit', () => {
    const { container } = render(<StepNumber n={2} state="done" />);
    expect(container).not.toHaveTextContent('2');
    expect(container.firstElementChild).toHaveClass('sn', 'done');
  });
  it('shows the number', () => {
    render(<StepNumber n={3} state="current" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});

describe('CommandChip / InlineStatus', () => {
  it('command is code.cmd', () => {
    render(<CommandChip>/run</CommandChip>);
    expect(screen.getByText('/run').tagName).toBe('CODE');
    expect(screen.getByText('/run')).toHaveClass('cmd');
  });
  it('inline status has tone class and text', () => {
    render(<InlineStatus tone="ok">Connected</InlineStatus>);
    expect(screen.getByText('Connected').closest('span.inline-status')).toHaveClass('ok');
  });
});
