import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar } from './Avatar';
import { CommandChip } from './CommandChip';
import { CountBadge } from './CountBadge';
import { InlineStatus } from './InlineStatus';
import { LabelChip } from './LabelChip';
import { StepNumber } from './StepNumber';
import { TicketRef } from './TicketRef';

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
