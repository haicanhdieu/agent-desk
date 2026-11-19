import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TerminalFindBar } from './TerminalFindBar';
import { findMatches } from './terminalFind';

const handlers = () => ({ onQueryChange: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn() });

describe('TerminalFindBar', () => {
  it('focuses the box, steps with Enter and Shift+Enter, and closes with Escape', async () => {
    const h = handlers();
    render(<TerminalFindBar query="a" total={3} current={0} {...h} />);
    const box = screen.getByRole('searchbox', { name: 'Find in log' });
    expect(box).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(h.onNext).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(h.onPrev).toHaveBeenCalledOnce();
    await userEvent.keyboard('{Escape}');
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it('lets Enter on a focused button act on that button, not step to the next match', async () => {
    const h = handlers();
    render(<TerminalFindBar query="a" total={3} current={0} {...h} />);
    screen.getByRole('button', { name: 'Close find' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.onNext).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Previous match' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(h.onPrev).toHaveBeenCalledOnce();
    expect(h.onNext).not.toHaveBeenCalled();
  });

  it('shows nothing for an empty query and disables stepping when there is no match', () => {
    const h = handlers();
    const { rerender } = render(<TerminalFindBar query="" total={0} current={0} {...h} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    rerender(<TerminalFindBar query="zz" total={0} current={0} {...h} />);
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
  });
});

describe('findMatches', () => {
  it('finds matches across spans, ignoring case and never overlapping', () => {
    const lines = [[{ text: 'aaa' }, { text: 'Aa' }], [], [{ text: 'b' }]];
    expect(findMatches(lines, 'aa')).toEqual([
      { line: 0, start: 0, end: 2 },
      { line: 0, start: 2, end: 4 },
    ]);
    expect(findMatches(lines, '')).toEqual([]);
  });
});
